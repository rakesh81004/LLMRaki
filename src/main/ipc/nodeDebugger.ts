import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import WebSocket from 'ws'

// Real breakpoint/step/variable debugging for plain Node.js (.js/.mjs) scripts, talking directly
// to V8's inspector protocol (the same JSON-RPC-over-WebSocket protocol Chrome DevTools speaks to
// a running Node process via `--inspect`) rather than shelling out to `node file.js`.

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

interface ScriptInfo {
  url: string
}

export interface BreakpointGroup {
  path: string
  lines: number[]
}

function pathToFileUrl(filePath: string): string {
  return `file://${filePath}`
}

function fileUrlToPath(url: string): string {
  return url.startsWith('file://') ? url.slice('file://'.length) : url
}

interface RemoteObject {
  type: string
  subtype?: string
  className?: string
  value?: unknown
  description?: string
  objectId?: string
}

interface CDPCallFrame {
  callFrameId: string
  functionName: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  scopeChain: { type: string; name?: string; object: RemoteObject }[]
}

export interface DebugScope {
  type: string
  name?: string
  objectId?: string
}

export interface DebugCallFrame {
  callFrameId: string
  functionName: string
  path: string
  line: number
  column: number
  scopes: DebugScope[]
}

class DebugSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private ws: WebSocket | null = null
  private nextMsgId = 1
  private pending = new Map<number, PendingRequest>()
  private scripts = new Map<string, ScriptInfo>()
  private breakpointIds = new Map<string, string>()
  private stopped = false

  constructor(
    private readonly id: string,
    private readonly win: BrowserWindow,
    private readonly entryPath: string
  ) {}

  private emit(channel: string, payload?: unknown): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.send(`debug:${channel}:${this.id}`, payload)
  }

  async start(initialBreakpoints: BreakpointGroup[]): Promise<void> {
    const cwd = this.entryPath.slice(0, this.entryPath.lastIndexOf('/')) || undefined
    const child = spawn('node', ['--inspect-brk=0', this.entryPath], { cwd })
    this.child = child

    child.stdout.on('data', (chunk: Buffer) => {
      this.emit('output', { stream: 'stdout', text: chunk.toString() })
    })

    let connecting = false
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const match = text.match(/Debugger listening on (ws:\/\/\S+)/)
      if (match && !connecting) {
        connecting = true
        this.connect(match[1], initialBreakpoints).catch((err) => {
          this.emit('error', err instanceof Error ? err.message : String(err))
        })
        return
      }
      if (/^(Debugger attached|Waiting for the debugger|For help, see:)/.test(text.trim())) return
      this.emit('output', { stream: 'stderr', text })
    })

    child.on('error', (err) => {
      this.emit('error', err.message)
    })

    child.on('exit', (code) => {
      this.stopped = true
      this.ws?.close()
      this.emit('terminated', { code })
    })
  }

  private connect(wsUrl: string, initialBreakpoints: BreakpointGroup[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.on('open', () => {
        void (async () => {
          try {
            await this.send('Runtime.enable')
            await this.send('Debugger.enable')
            for (const group of initialBreakpoints) {
              for (const line of group.lines) {
                await this.setBreakpoint(group.path, line)
              }
            }
            await this.send('Runtime.runIfWaitingForDebugger')
            resolve()
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })()
      })

      ws.on('message', (data) => this.handleMessage(data.toString()))
      ws.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
    })
  }

  private handleMessage(raw: string): void {
    let msg: {
      id?: number
      method?: string
      result?: unknown
      error?: { message: string }
      params?: Record<string, unknown>
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message))
      else pending.resolve(msg.result)
      return
    }

    if (msg.method === 'Debugger.scriptParsed' && msg.params) {
      const scriptId = msg.params.scriptId as string
      const url = msg.params.url as string
      if (url) this.scripts.set(scriptId, { url })
      return
    }

    if (msg.method === 'Debugger.paused' && msg.params) {
      // `--inspect-brk` always halts on the very first statement so a debugger can attach and
      // set breakpoints before anything runs — V8 reports this as a real pause ("Break on
      // start"), distinct from (and requiring its own resume beyond) Runtime.runIfWaitingForDebugger.
      // Surfacing it would show a "paused" state before the program has done anything; skip
      // straight through it so only breakpoints the user actually set stop execution.
      if (msg.params.reason === 'Break on start') {
        void this.send('Debugger.resume')
        return
      }
      const rawFrames = msg.params.callFrames as CDPCallFrame[]
      const callFrames: DebugCallFrame[] = rawFrames.map((f) => ({
        callFrameId: f.callFrameId,
        functionName: f.functionName || '(anonymous)',
        path: fileUrlToPath(this.scripts.get(f.location.scriptId)?.url ?? ''),
        line: f.location.lineNumber + 1,
        column: f.location.columnNumber + 1,
        scopes: f.scopeChain
          .filter((s) => s.type !== 'global')
          .map((s) => ({ type: s.type, name: s.name, objectId: s.object.objectId }))
      }))
      this.emit('paused', { callFrames, reason: msg.params.reason })
      return
    }

    if (msg.method === 'Debugger.resumed') {
      this.emit('resumed')
      return
    }

    if (msg.method === 'Runtime.consoleAPICalled' && msg.params) {
      const args = (msg.params.args as RemoteObject[]) ?? []
      const text = args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? ''))).join(' ')
      this.emit('output', { stream: 'console', text: text + '\n' })
    }
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Debug session is not connected'))
        return
      }
      const id = this.nextMsgId++
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async setBreakpoint(filePath: string, line: number): Promise<void> {
    const result = await this.send('Debugger.setBreakpointByUrl', {
      url: pathToFileUrl(filePath),
      lineNumber: line - 1,
      columnNumber: 0
    })
    this.breakpointIds.set(`${filePath}:${line}`, (result as { breakpointId: string }).breakpointId)
  }

  async removeBreakpoint(filePath: string, line: number): Promise<void> {
    const key = `${filePath}:${line}`
    const breakpointId = this.breakpointIds.get(key)
    if (!breakpointId) return
    this.breakpointIds.delete(key)
    await this.send('Debugger.removeBreakpoint', { breakpointId })
  }

  resume(): Promise<unknown> {
    return this.send('Debugger.resume')
  }
  stepOver(): Promise<unknown> {
    return this.send('Debugger.stepOver')
  }
  stepInto(): Promise<unknown> {
    return this.send('Debugger.stepInto')
  }
  stepOut(): Promise<unknown> {
    return this.send('Debugger.stepOut')
  }
  pauseExecution(): Promise<unknown> {
    return this.send('Debugger.pause')
  }

  async getProperties(objectId: string): Promise<unknown> {
    const result = await this.send('Runtime.getProperties', { objectId, ownProperties: true })
    return (result as { result: unknown }).result
  }

  evaluate(callFrameId: string, expression: string): Promise<unknown> {
    return this.send('Debugger.evaluateOnCallFrame', { callFrameId, expression })
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.ws?.close()
    this.child?.kill()
  }
}

const sessions = new Map<string, DebugSession>()

export function registerNodeDebuggerHandlers(): void {
  ipcMain.handle(
    'debug:start',
    async (event, sessionId: string, entryPath: string, breakpoints: BreakpointGroup[]) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      const session = new DebugSession(sessionId, win, entryPath)
      sessions.set(sessionId, session)
      await session.start(breakpoints)
    }
  )

  ipcMain.handle('debug:setBreakpoint', async (_e, sessionId: string, filePath: string, line: number) => {
    await sessions.get(sessionId)?.setBreakpoint(filePath, line)
  })

  ipcMain.handle('debug:removeBreakpoint', async (_e, sessionId: string, filePath: string, line: number) => {
    await sessions.get(sessionId)?.removeBreakpoint(filePath, line)
  })

  ipcMain.handle('debug:continue', async (_e, sessionId: string) => {
    await sessions.get(sessionId)?.resume()
  })
  ipcMain.handle('debug:stepOver', async (_e, sessionId: string) => {
    await sessions.get(sessionId)?.stepOver()
  })
  ipcMain.handle('debug:stepInto', async (_e, sessionId: string) => {
    await sessions.get(sessionId)?.stepInto()
  })
  ipcMain.handle('debug:stepOut', async (_e, sessionId: string) => {
    await sessions.get(sessionId)?.stepOut()
  })
  ipcMain.handle('debug:pause', async (_e, sessionId: string) => {
    await sessions.get(sessionId)?.pauseExecution()
  })

  ipcMain.handle('debug:getProperties', async (_e, sessionId: string, objectId: string) => {
    return (await sessions.get(sessionId)?.getProperties(objectId)) ?? []
  })

  ipcMain.handle(
    'debug:evaluate',
    async (_e, sessionId: string, callFrameId: string, expression: string) => {
      return sessions.get(sessionId)?.evaluate(callFrameId, expression)
    }
  )

  ipcMain.handle('debug:stop', async (_e, sessionId: string) => {
    sessions.get(sessionId)?.stop()
    sessions.delete(sessionId)
  })
}

export function killAllDebugSessions(): void {
  for (const session of sessions.values()) session.stop()
  sessions.clear()
}
