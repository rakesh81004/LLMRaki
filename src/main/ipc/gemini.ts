import { ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { getDecryptedGeminiKey, getGeminiModel } from './settings'
import { findMatchingFiles, IGNORED_DIRS, MAX_FILE_SIZE, extractKeywords } from './search'
import type { ChatMessage } from './openai'

const activeRequests = new Map<string, AbortController>()

export type AgentMode = 'ask' | 'edit' | 'auto'

const pendingPermissions = new Map<string, (allowed: boolean) => void>()

export interface GeminiModelInfo {
  id: string
  displayName: string
  description: string
  inputTokenLimit?: number
  outputTokenLimit?: number
}

export type GeminiAvailabilityStatus = 'available' | 'rate_limited' | 'no_access' | 'error'

export interface GeminiAvailability {
  id: string
  status: GeminiAvailabilityStatus
  message?: string
}

const modelListCache = new Map<string, { fetchedAt: number; models: GeminiModelInfo[] }>()
const MODEL_LIST_TTL_MS = 5 * 60 * 1000

// Google's model list mixes real chat models in with TTS/image/audio/embedding/computer-use models that also declare `generateContent` support but will never answer a chat request.
const NON_CHAT_MODEL_RE = /-tts|-image|-audio|-live|computer-use|embedding|aqa|imagen|veo/i

async function fetchModelList(apiKey: string): Promise<GeminiModelInfo[]> {
  const cached = modelListCache.get(apiKey)
  if (cached && Date.now() - cached.fetchedAt < MODEL_LIST_TTL_MS) {
    return cached.models
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    )
    if (!response.ok) return cached?.models ?? []
    const data = await response.json()
    const models: unknown[] = data.models ?? []
    const parsed = models
      .filter(
        (m): m is Record<string, unknown> =>
          typeof m === 'object' &&
          m !== null &&
          Array.isArray((m as Record<string, unknown>).supportedGenerationMethods) &&
          ((m as Record<string, unknown>).supportedGenerationMethods as string[]).includes(
            'generateContent'
          ) &&
          /^models\/gemini-\d/i.test(String((m as Record<string, unknown>).name)) &&
          !NON_CHAT_MODEL_RE.test(String((m as Record<string, unknown>).name))
      )
      .map((m) => ({
        id: String(m.name).replace(/^models\//, ''),
        displayName: (m.displayName as string) ?? String(m.name),
        description: (m.description as string) ?? '',
        inputTokenLimit: m.inputTokenLimit as number | undefined,
        outputTokenLimit: m.outputTokenLimit as number | undefined
      }))
    modelListCache.set(apiKey, { fetchedAt: Date.now(), models: parsed })
    return parsed
  } catch {
    return cached?.models ?? []
  }
}

function rankModel(id: string): number {
  const versionMatch = id.match(/^gemini-(\d+(?:\.\d+)?)/)
  const version = versionMatch ? parseFloat(versionMatch[1]) : 0
  let tier = 1
  if (id.includes('flash-lite')) tier = 1
  else if (id.includes('flash')) tier = 2
  else if (id.includes('pro')) tier = 3
  const experimentalPenalty = /(exp|preview|thinking)/.test(id) ? -0.5 : 0
  return version * 10 + tier + experimentalPenalty
}

async function getCandidateModels(apiKey: string, preferredModel: string): Promise<string[]> {
  const available = await fetchModelList(apiKey)
  if (available.length === 0) return [preferredModel]
  const ranked = available.map((m) => m.id).sort((a, b) => rankModel(b) - rankModel(a))
  const rest = ranked.filter((id) => id !== preferredModel)
  return [preferredModel, ...rest]
}

interface GeminiFunctionCall {
  name: string
  args?: Record<string, unknown>
}
interface GeminiPart {
  text?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: { name: string; response: Record<string, unknown> }
  inlineData?: { mimeType: string; data: string }
}
interface GeminiContent {
  role: string
  parts: GeminiPart[]
}
interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

function toGeminiContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: { text: string }[] }
  contents: GeminiContent[]
} {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }))
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.images ?? []).map((img) => ({
          inlineData: { mimeType: img.mimeType, data: img.data }
        }))
      ]
    }))
  return systemParts.length > 0
    ? { systemInstruction: { parts: systemParts }, contents }
    : { contents }
}

function isNonRetryable(status: number): boolean {
  return status === 400 || status === 401
}

function parseRetryDelaySeconds(errorText: string): number | null {
  const match = errorText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  if (!match) return null
  const seconds = Math.ceil(parseFloat(match[1]))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

const MAX_RATE_LIMIT_WAIT_SECONDS = 90

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

async function streamGeminiChat(
  win: BrowserWindow,
  requestId: string,
  messages: ChatMessage[]
): Promise<void> {
  const channel = (suffix: string) => `ai:${suffix}:${requestId}`
  const apiKey = await getDecryptedGeminiKey()

  if (!apiKey) {
    win.webContents.send(channel('error'), 'No Gemini API key set. Add one in Settings.')
    return
  }

  const preferredModel = await getGeminiModel()
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  const body = JSON.stringify(toGeminiContents(messages))

  try {
    const candidates = await getCandidateModels(apiKey, preferredModel)
    let response: Response | undefined
    let usedModel = preferredModel
    let attemptErrors: string[] = []

    for (let round = 0; round < 2; round++) {
      attemptErrors = []
      let minRetryDelay: number | null = null
      let allRateLimited = candidates.length > 0

      for (const candidate of candidates) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:streamGenerateContent?alt=sse&key=${apiKey}`
        let attempt: Response
        try {
          attempt = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal
          })
        } catch (err) {
          if (controller.signal.aborted) throw err
          attemptErrors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`)
          allRateLimited = false
          continue
        }

        if (attempt.ok && attempt.body) {
          response = attempt
          usedModel = candidate
          break
        }

        const text = await attempt.text().catch(() => '')
        attemptErrors.push(`${candidate} (${attempt.status}): ${text}`)
        if (attempt.status === 429) {
          const delay = parseRetryDelaySeconds(text)
          if (delay !== null) minRetryDelay = minRetryDelay === null ? delay : Math.min(minRetryDelay, delay)
        } else {
          allRateLimited = false
        }
        if (isNonRetryable(attempt.status)) {
          allRateLimited = false
          break
        }
      }

      if (response) break
      if (round === 1 || !allRateLimited || minRetryDelay === null) break

      const waitSeconds = Math.min(minRetryDelay, MAX_RATE_LIMIT_WAIT_SECONDS)
      win.webContents.send(channel('rateLimited'), waitSeconds)
      await sleepUnlessAborted(waitSeconds * 1000, controller.signal)
    }

    if (!response || !response.body) {
      const summary =
        attemptErrors.length > 1
          ? `All ${attemptErrors.length} attempted models failed:\n` + attemptErrors.join('\n')
          : (attemptErrors[0] ?? 'All Gemini models failed.')
      win.webContents.send(channel('error'), summary)
      return
    }

    if (usedModel !== preferredModel) {
      win.webContents.send(channel('modelSwitched'), usedModel)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text
          if (delta) {
            win.webContents.send(channel('chunk'), delta)
          }
        } catch {}
      }
    }
    win.webContents.send(channel('done'))
  } catch (err) {
    if (controller.signal.aborted) {
      win.webContents.send(channel('done'))
    } else {
      const message = err instanceof Error ? err.message : String(err)
      win.webContents.send(channel('error'), message)
    }
  } finally {
    activeRequests.delete(requestId)
  }
}

const READ_TOOL_DECLS = [
  {
    name: 'search_files',
    description:
      'Search the project for files whose name or content match keywords. Returns up to 15 matching files with a short snippet each. Call this multiple times with different keywords as you investigate — start broad, then narrow down.',
    parameters: {
      type: 'OBJECT',
      properties: { query: { type: 'STRING', description: 'Keywords to search for' } },
      required: ['query']
    }
  },
  {
    name: 'read_file',
    description:
      'Read the full contents of one file. The path should be relative to the project root, exactly as returned by search_files or list_directory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path relative to the project root' }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List the files and subfolders inside a directory. Use "." for the project root.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Directory path relative to the project root, or "."' }
      },
      required: ['path']
    }
  }
]

const EDIT_TOOL_DECLS = [
  {
    name: 'write_file',
    description:
      'Create a new file or overwrite an existing file with the given full file content, relative to the project root. This is the only way to change code — it applies immediately and is shown to the user with an undo option, so do not ask the user for permission before calling this.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path relative to the project root' },
        content: { type: 'STRING', description: 'The complete new content of the file' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_terminal_command',
    description:
      'Run a shell command in the project root (running tests/builds, git commands, moving/deleting local files, etc). Most commands run immediately. Installing a package, pushing/publishing outside the project, or hitting a third-party endpoint directly (curl/wget/ssh/etc) pauses for the user to explicitly allow or deny it first — that check is handled automatically by the app based on the command, so just call this tool normally either way. If the user denies a paused command, do not retry the same command; explain and suggest an alternative instead.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'The shell command to run' }
      },
      required: ['command']
    }
  }
]

function buildTools(mode: AgentMode): { functionDeclarations: unknown[] }[] {
  const decls = mode === 'ask' ? READ_TOOL_DECLS : [...READ_TOOL_DECLS, ...EDIT_TOOL_DECLS]
  return [{ functionDeclarations: decls }]
}

const TERMINAL_POLICY =
  'For run_terminal_command: most commands (building, testing, git commit/checkout/branch/merge, moving/creating/deleting local files, etc.) run immediately — just call them normally, no need to warn the user first. Only three things ever pause for the user\'s explicit permission, handled automatically by the app based on the command itself: installing a package (npm/pip/brew/etc install), pushing or publishing something outside the project (git push, npm publish, docker push), or talking directly to a third-party endpoint (curl, wget, ssh, scp, etc). You never need to ask the user in chat either way — just call the tool and respect whatever comes back. ' +
  'When asked to undo, revert, or roll back changes — especially your own previous edits in this conversation — do it by calling write_file directly with the original content (which you already read or wrote earlier in this conversation), NOT by running a broad git command like `git checkout -- <path>`, `git reset`, or `git clean`. Those operate on the whole working tree and would also discard the user\'s own unrelated uncommitted work, not just your edits — the exact opposite of "revert only the changes made by you". Only use a git-based revert if the user explicitly asks for a git reset/checkout by name.'

const APPLY_INSTRUCTION =
  'When the user asks you to fix, change, add, remove, refactor, clean up, or optimize something in the code, you MUST actually call write_file to make that change yourself — do not just describe the fix, list what should change, or print "here is the optimized/clean implementation" as a fenced code block in your text response and stop there. A code block in your chat reply is NEVER a substitute for calling write_file — if you already know what the new file content should be (you just wrote it out to show the user), that means you have everything you need to call write_file with that exact content right now, so do it instead of only printing it. Describing or showing example code without calling write_file is treated as not having done the task at all. Only skip write_file if the user is purely asking a question with no request to change anything. ' +
  'If the same fix/pattern applies to multiple files (e.g. "remove use client from these 12 components", "apply this optimization across all X sections"), apply it directly to EVERY one of those files via write_file in this response — do not fix just one file as a demonstration and list the rest under "next steps" or "apply this same pattern to" for the user to ask about again; that is treated as leaving the task unfinished. If you truly cannot get to every file within your tool budget, apply write_file to as many as you can and explicitly say which ones are left, rather than doing only one and describing the rest. ' +
  'In your final answer, NEVER say a file was fixed/changed/updated/cleaned up/optimized unless you actually got a successful write_file result for that exact file earlier in this same conversation — for every file you identified but did not actually call write_file on, say plainly that you did not get to it yet, do not imply it was done.'

const MODE_INSTRUCTIONS: Record<AgentMode, string> = {
  ask: 'You are in ASK mode: read-only. You can search, list, and read files, but you cannot create or edit files or run terminal commands. If the user wants changes made, tell them to switch to Edit or Auto mode.',
  edit:
    'You are in EDIT mode. ' +
    APPLY_INSTRUCTION +
    ' Edits apply immediately and the user sees a real diff with an undo option, so do not ask permission before editing files. ' +
    TERMINAL_POLICY,
  auto:
    'You are in AUTO mode. ' +
    APPLY_INSTRUCTION +
    ' Work autonomously through multi-step tasks — read, search, and edit as many files as needed via write_file without pausing to ask the user for confirmation on each edit. ' +
    TERMINAL_POLICY
}

function toRelative(root: string, filePath: string): string {
  return filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath
}

function withLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n')
}

function firstMatchingLine(content: string, keywords: string[]): { line: number; text: string } {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase()
    if (keywords.some((kw) => lower.includes(kw))) {
      return { line: i + 1, text: lines[i].trim().slice(0, 200) }
    }
  }
  return { line: 1, text: content.trim().slice(0, 200) }
}

function requestTerminalPermission(
  win: BrowserWindow,
  requestId: string,
  command: string,
  cwd: string
): { permissionId: string; allowed: Promise<boolean> } {
  const permissionId = `${requestId}-${Math.random().toString(36).slice(2)}`
  const allowed = new Promise<boolean>((resolve) => {
    pendingPermissions.set(permissionId, resolve)
    win.webContents.send(`ai:permissionRequest:${requestId}`, { permissionId, command, cwd })
  })
  return { permissionId, allowed }
}

const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm'])
const INSTALL_SUBCOMMANDS = new Set(['install', 'i', 'add', 'ci'])

function commandNeedsPermission(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return true
  if (/\bsudo\b/.test(trimmed)) return true

  const segments = trimmed
    .split(/&&|\|\||\||;/)
    .map((s) => s.trim())
    .filter(Boolean)

  return segments.some((seg) => {
    const tokens = seg.split(/\s+/)
    const base = tokens[0]
    const rest = tokens.slice(1)

    if (PACKAGE_MANAGERS.has(base) && rest.some((t) => INSTALL_SUBCOMMANDS.has(t))) return true
    if ((base === 'pip' || base === 'pip3') && rest[0] === 'install') return true
    if (base === 'gem' && rest[0] === 'install') return true
    if (base === 'brew' && rest[0] === 'install') return true
    if ((base === 'apt' || base === 'apt-get') && rest[0] === 'install') return true
    if (base === 'cargo' && rest[0] === 'install') return true
    if (base === 'go' && (rest[0] === 'get' || rest[0] === 'install')) return true
    if (base === 'composer' && (rest[0] === 'install' || rest[0] === 'require')) return true

    if (base === 'git' && rest[0] === 'push') return true
    if (PACKAGE_MANAGERS.has(base) && rest[0] === 'publish') return true
    if (base === 'docker' && rest[0] === 'push') return true

    if (['curl', 'wget', 'http', 'httpie', 'nc', 'netcat', 'telnet', 'ssh', 'scp'].includes(base)) return true

    return false
  })
}

const COMMAND_TIMEOUT_MS = 60_000
const COMMAND_MAX_OUTPUT = 8000

function runShellCommand(command: string, cwd: string): Promise<{ output: string; error: boolean }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const combined = `${stdout}${stderr}`.trim()
      const output = combined.length > COMMAND_MAX_OUTPUT ? combined.slice(0, COMMAND_MAX_OUTPUT) + '\n…(truncated)' : combined
      resolve({ output: output || (err ? err.message : '(no output)'), error: Boolean(err) })
    })
  })
}

async function executeAgentTool(
  rootFolder: string,
  name: string,
  args: Record<string, unknown>,
  win: BrowserWindow,
  requestId: string,
  mode: AgentMode
): Promise<{ progressLabel: string; resultForModel: unknown }> {
  if (name === 'search_files') {
    const query = typeof args.query === 'string' ? args.query : ''
    const keywords = extractKeywords(query)
    const matches = await findMatchingFiles(rootFolder, query, 15)
    const forModel = matches.map((m) => {
      const { line, text } = firstMatchingLine(m.content, keywords)
      return { path: toRelative(rootFolder, m.path), line, preview: text }
    })
    return {
      progressLabel: `Searched for "${query}" (${forModel.length} match${forModel.length === 1 ? '' : 'es'})`,
      resultForModel: forModel.length > 0 ? forModel : 'No matches found.'
    }
  }

  if (name === 'read_file') {
    const rel = typeof args.path === 'string' ? args.path : ''
    const fullPath = path.isAbsolute(rel) ? rel : path.join(rootFolder, rel)
    try {
      const stat = await fs.stat(fullPath)
      if (stat.size > MAX_FILE_SIZE) {
        return { progressLabel: `Read ${rel} (too large)`, resultForModel: 'File too large to read.' }
      }
      const content = await fs.readFile(fullPath, 'utf-8')
      const numbered = withLineNumbers(content)
      const truncated = numbered.length > 8000
      return {
        progressLabel: `Read ${rel}`,
        resultForModel: truncated ? numbered.slice(0, 8000) + '\n…(truncated)' : numbered
      }
    } catch (err) {
      return {
        progressLabel: `Read ${rel} (not found)`,
        resultForModel: `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  if (name === 'list_directory') {
    const rel = typeof args.path === 'string' && args.path ? args.path : '.'
    const fullPath = rel === '.' ? rootFolder : path.isAbsolute(rel) ? rel : path.join(rootFolder, rel)
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true })
      const listing = entries
        .filter((e) => !IGNORED_DIRS.has(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      return { progressLabel: `Listed ${rel}`, resultForModel: listing }
    } catch (err) {
      return {
        progressLabel: `Listed ${rel} (error)`,
        resultForModel: `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  if (name === 'write_file' || name === 'run_terminal_command') {
    if (mode === 'ask') {
      return {
        progressLabel: `Blocked: ${name}`,
        resultForModel: 'Error: this session is in Ask mode (read-only). Tell the user to switch to Edit or Auto mode to make changes.'
      }
    }
  }

  if (name === 'write_file') {
    const rel = typeof args.path === 'string' ? args.path : ''
    const content = typeof args.content === 'string' ? args.content : ''
    const fullPath = path.isAbsolute(rel) ? rel : path.join(rootFolder, rel)
    let oldContent: string | null = null
    try {
      oldContent = await fs.readFile(fullPath, 'utf-8')
    } catch {
      oldContent = null
    }
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf-8')
      win.webContents.send(`ai:fileEdit:${requestId}`, {
        path: fullPath,
        relativePath: rel,
        oldContent,
        newContent: content
      })
      return { progressLabel: `Edited ${rel}`, resultForModel: 'File written successfully.' }
    } catch (err) {
      return {
        progressLabel: `Failed to write ${rel}`,
        resultForModel: `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  if (name === 'run_terminal_command') {
    const command = typeof args.command === 'string' ? args.command : ''
    if (!command) {
      return { progressLabel: 'No command given', resultForModel: 'Error: no command provided.' }
    }

    if (!commandNeedsPermission(command)) {
      const { output, error } = await runShellCommand(command, rootFolder)
      win.webContents.send(`ai:commandAutoRun:${requestId}`, { command, output, error })
      return {
        progressLabel: error ? `Ran (auto): ${command} (failed)` : `Ran (auto): ${command}`,
        resultForModel: `${error ? 'Command exited with an error.' : 'Command succeeded.'}\nOutput:\n${output}`
      }
    }

    const { permissionId, allowed: allowedPromise } = requestTerminalPermission(win, requestId, command, rootFolder)
    const allowed = await allowedPromise
    if (!allowed) {
      return {
        progressLabel: `Denied: ${command}`,
        resultForModel: 'The user denied permission to run this command. Do not retry it — explain and suggest an alternative if relevant.'
      }
    }
    const { output, error } = await runShellCommand(command, rootFolder)
    win.webContents.send(`ai:commandResult:${requestId}`, { permissionId, command, output, error })
    return {
      progressLabel: error ? `Command failed: ${command}` : `Ran: ${command}`,
      resultForModel: `${error ? 'Command exited with an error.' : 'Command succeeded.'}\nOutput:\n${output}`
    }
  }

  return { progressLabel: `Unknown tool ${name}`, resultForModel: `Error: unknown tool "${name}"` }
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  contents: GeminiContent[],
  systemInstruction: { parts: { text: string }[] } | undefined,
  tools: ReturnType<typeof buildTools> | null,
  signal: AbortSignal
): Promise<{ ok: true; data: GeminiGenerateResponse } | { ok: false; status: number; text: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const body: Record<string, unknown> = { contents }
  if (systemInstruction) body.systemInstruction = systemInstruction
  if (tools) body.tools = tools

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    if (signal.aborted) throw err
    return { ok: false, status: 0, text: err instanceof Error ? err.message : String(err) }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { ok: false, status: response.status, text }
  }
  const data = (await response.json()) as GeminiGenerateResponse
  return { ok: true, data }
}

async function runGeminiAgent(
  win: BrowserWindow,
  requestId: string,
  messages: ChatMessage[],
  rootFolder: string,
  mode: AgentMode
): Promise<void> {
  const channel = (suffix: string) => `ai:${suffix}:${requestId}`
  const decryptedKey = await getDecryptedGeminiKey()

  if (!decryptedKey) {
    win.webContents.send(channel('error'), 'No Gemini API key set. Add one in Settings.')
    return
  }
  const apiKey: string = decryptedKey

  const preferredModel = await getGeminiModel()
  const controller = new AbortController()
  activeRequests.set(requestId, controller)

  try {
    const converted = toGeminiContents(messages)
    let contents = converted.contents
    const citationInstruction = {
      text:
        'When you reference specific code, cite the file inline in backticks using the format ' +
        '`relative/path/to/file.ext:LINE` (relative to the project root, using the exact path from ' +
        'search_files/read_file/list_directory) whenever you know the line number, or just ' +
        '`relative/path/to/file.ext` if you do not. This lets the app turn your citations into ' +
        'clickable links, so use this format consistently instead of prose like "in the file X".\n\n' +
        'read_file output has each line prefixed with its real line number and a colon (e.g. `42: const x = 1`) ' +
        'so you always know exact line numbers — never guess or count them yourself. When quoting code in your ' +
        'answer, strip that `N: ` prefix from each line so the shown code is clean, but whenever you show a ' +
        "multi-line excerpt taken directly from a file you read (not a made-up example), make the very first " +
        'line inside that fenced code block exactly `LOC_START:N` (no other text on that line), where N is the ' +
        "real line number of the excerpt's first actual code line. The app strips this marker and uses it to " +
        'number the rest of the excerpt to match the real file, instead of always starting at 1.'
    }
    const efficiencyInstruction = {
      text:
        'Each response turn you take costs one real API call against a tight rate limit (as low as 5 ' +
        'requests/minute on the free tier), so minimize turns: whenever you know you need to call several ' +
        'tools (e.g. reading multiple files, or running a search plus reading what it finds), issue all of ' +
        'those tool calls together in the SAME turn instead of one at a time across separate turns. Only take ' +
        'a new turn when you genuinely cannot decide the next call without seeing a previous result. Do not ' +
        'sacrifice correctness for this — never skip reading a file you actually need — just batch what you ' +
        'already know you need together rather than trickling calls out one by one.'
    }
    const modeInstruction = { text: MODE_INSTRUCTIONS[mode] }
    const systemInstruction = converted.systemInstruction
      ? { parts: [...converted.systemInstruction.parts, citationInstruction, efficiencyInstruction, modeInstruction] }
      : { parts: [citationInstruction, efficiencyInstruction, modeInstruction] }
    const tools = buildTools(mode)

    const allCandidates = await getCandidateModels(apiKey, preferredModel)
    const rateLimited = new Set<string>()
    let lastUsedModel = preferredModel

    async function callWithFallback(
      requestContents: GeminiContent[]
    ): Promise<{ model: string; data: GeminiGenerateResponse } | { error: string }> {
      let errors: string[] = []

      for (let round = 0; round < 2; round++) {
        const ordered = allCandidates.filter((m) => !rateLimited.has(m))
        const candidates = ordered.length > 0 ? ordered : allCandidates
        errors = []
        let minRetryDelay: number | null = null
        let allRateLimited = candidates.length > 0

        for (const candidate of candidates) {
          const result = await callGeminiOnce(
            apiKey,
            candidate,
            requestContents,
            systemInstruction,
            tools,
            controller.signal
          )
          if (result.ok) return { model: candidate, data: result.data }
          errors.push(`${candidate} (${result.status}): ${result.text}`)
          if (result.status === 429) {
            rateLimited.add(candidate)
            const delay = parseRetryDelaySeconds(result.text)
            if (delay !== null) minRetryDelay = minRetryDelay === null ? delay : Math.min(minRetryDelay, delay)
          } else {
            allRateLimited = false
          }
          if (isNonRetryable(result.status)) {
            allRateLimited = false
            break
          }
        }

        if (round === 1 || !allRateLimited || minRetryDelay === null) break

        const waitSeconds = Math.min(minRetryDelay, MAX_RATE_LIMIT_WAIT_SECONDS)
        win.webContents.send(channel('rateLimited'), waitSeconds)
        try {
          await sleepUnlessAborted(waitSeconds * 1000, controller.signal)
        } catch {
          return { error: 'Cancelled while waiting for the rate limit to reset.' }
        }
        rateLimited.clear()
      }

      return {
        error:
          errors.length > 1
            ? `All ${errors.length} attempted models failed:\n` + errors.join('\n')
            : (errors[0] ?? 'All Gemini models failed.')
      }
    }

    const first = await callWithFallback(contents)
    if ('error' in first) {
      win.webContents.send(channel('error'), first.error)
      return
    }
    let model = first.model
    let data = first.data
    if (model !== preferredModel) {
      win.webContents.send(channel('modelSwitched'), model)
    }
    lastUsedModel = model

    let toolCallCount = 0
    const MAX_TOOL_CALLS = mode === 'ask' ? 12 : 40
    let emptyResponseRetried = false

    for (;;) {
      const parts = data.candidates?.[0]?.content?.parts ?? []
      const functionCalls = parts.filter((p): p is GeminiPart & { functionCall: GeminiFunctionCall } =>
        Boolean(p.functionCall)
      )

      if (functionCalls.length === 0) {
        const text = parts.map((p) => p.text ?? '').join('')
        if (!text) {
          const finishReason = data.candidates?.[0]?.finishReason
          const blockReason = data.promptFeedback?.blockReason

          if (blockReason || finishReason === 'SAFETY' || finishReason === 'RECITATION') {
            win.webContents.send(
              channel('error'),
              `Gemini declined to answer (${blockReason ?? finishReason}) — try rephrasing your question.`
            )
            return
          }

          if (!emptyResponseRetried) {
            emptyResponseRetried = true
            contents = [
              ...contents,
              { role: 'model', parts },
              {
                role: 'user',
                parts: [
                  {
                    text: 'You returned an empty response. Please give your final answer now, in plain text — summarize what you found so far if needed.'
                  }
                ]
              }
            ]
            const retry = await callWithFallback(contents)
            if ('error' in retry) {
              win.webContents.send(channel('error'), retry.error)
              return
            }
            if (retry.model !== lastUsedModel) {
              win.webContents.send(channel('modelSwitched'), retry.model)
              lastUsedModel = retry.model
            }
            data = retry.data
            continue
          }

          const reasonHint = finishReason ? ` (finishReason: ${finishReason})` : ''
          win.webContents.send(
            channel('error'),
            `Gemini returned an empty response twice in a row${reasonHint}. Try asking a more specific or shorter question.`
          )
          return
        }
        const CHUNK_SIZE = 40
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          if (controller.signal.aborted) return
          win.webContents.send(channel('chunk'), text.slice(i, i + CHUNK_SIZE))
        }
        win.webContents.send(channel('done'))
        return
      }

      contents = [...contents, { role: 'model', parts }]
      const functionResponseParts: GeminiPart[] = []

      for (const fc of functionCalls) {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          functionResponseParts.push({
            functionResponse: {
              name: fc.functionCall.name,
              response: {
                result:
                  'Tool call limit reached — this call did NOT run, and nothing about it happened. ' +
                  'Wrap up now with the tools you already used. In your final answer, only claim a file was ' +
                  'changed if you actually got a successful write_file result for that exact file earlier in ' +
                  'this conversation — for anything you identified but did not reach, tell the user plainly ' +
                  'that you ran out of budget and list which files still need the fix applied, in a follow-up.'
              }
            }
          })
          continue
        }
        toolCallCount++
        const { progressLabel, resultForModel } = await executeAgentTool(
          rootFolder,
          fc.functionCall.name,
          fc.functionCall.args ?? {},
          win,
          requestId,
          mode
        )
        win.webContents.send(channel('progress'), progressLabel)
        functionResponseParts.push({
          functionResponse: { name: fc.functionCall.name, response: { result: resultForModel } }
        })
      }

      contents = [...contents, { role: 'user', parts: functionResponseParts }]

      const next = await callWithFallback(contents)
      if ('error' in next) {
        win.webContents.send(channel('error'), next.error)
        return
      }
      if (next.model !== lastUsedModel) {
        win.webContents.send(channel('modelSwitched'), next.model)
        lastUsedModel = next.model
      }
      model = next.model
      data = next.data
    }
  } catch (err) {
    if (controller.signal.aborted) {
      win.webContents.send(channel('done'))
    } else {
      win.webContents.send(channel('error'), err instanceof Error ? err.message : String(err))
    }
  } finally {
    activeRequests.delete(requestId)
  }
}

export function registerGeminiHandlers(): void {
  ipcMain.handle(
    'gemini:sendMessage',
    async (
      event,
      requestId: string,
      messages: ChatMessage[],
      rootFolder?: string | null,
      mode?: AgentMode
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      if (rootFolder) {
        void runGeminiAgent(win, requestId, messages, rootFolder, mode ?? 'ask')
      } else {
        void streamGeminiChat(win, requestId, messages)
      }
    }
  )

  ipcMain.handle('agent:respondPermission', (_e, permissionId: string, allowed: boolean) => {
    const resolve = pendingPermissions.get(permissionId)
    if (resolve) {
      resolve(allowed)
      pendingPermissions.delete(permissionId)
    }
  })

  ipcMain.handle('gemini:cancel', async (_e, requestId: string) => {
    activeRequests.get(requestId)?.abort()
    for (const [permissionId, resolve] of pendingPermissions) {
      if (permissionId.startsWith(`${requestId}-`)) {
        resolve(false)
        pendingPermissions.delete(permissionId)
      }
    }
  })

  ipcMain.handle('gemini:listModels', async (): Promise<GeminiModelInfo[]> => {
    const apiKey = await getDecryptedGeminiKey()
    if (!apiKey) return []
    return fetchModelList(apiKey)
  })

  ipcMain.handle(
    'gemini:checkAvailability',
    async (_e, models: string[]): Promise<GeminiAvailability[]> => {
      const apiKey = await getDecryptedGeminiKey()
      if (!apiKey) {
        return models.map((id) => ({ id, status: 'error', message: 'No API key set' }))
      }

      const results: GeminiAvailability[] = []
      for (const id of models) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                generationConfig: { maxOutputTokens: 1 }
              })
            }
          )
          if (response.ok) {
            results.push({ id, status: 'available' })
          } else if (response.status === 429) {
            results.push({ id, status: 'rate_limited', message: 'Rate limit hit right now' })
          } else if (response.status === 403 || response.status === 404) {
            results.push({ id, status: 'no_access', message: 'Not enabled for this key' })
          } else {
            const text = await response.text().catch(() => '')
            results.push({ id, status: 'error', message: text.slice(0, 200) })
          }
        } catch (err) {
          results.push({
            id,
            status: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }
      return results
    }
  )
}
