import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import os from 'os'

const sessions = new Map<string, pty.IPty>()

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

export function registerTerminalHandlers(): void {
  ipcMain.handle('terminal:create', (event, id: string, cwd: string | null) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const shell = pty.spawn(defaultShell(), [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || os.homedir(),
      env: process.env as Record<string, string>
    })

    sessions.set(id, shell)

    shell.onData((data) => {
      win.webContents.send(`terminal:data:${id}`, data)
    })

    shell.onExit(() => {
      win.webContents.send(`terminal:exit:${id}`)
      sessions.delete(id)
    })
  })

  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    sessions.get(id)?.write(data)
  })

  ipcMain.handle('terminal:resize', (_e, id: string, cols: number, rows: number) => {
    sessions.get(id)?.resize(cols, rows)
  })

  ipcMain.handle('terminal:kill', (_e, id: string) => {
    sessions.get(id)?.kill()
    sessions.delete(id)
  })
}

export function killAllTerminals(): void {
  for (const shell of sessions.values()) {
    shell.kill()
  }
  sessions.clear()
}
