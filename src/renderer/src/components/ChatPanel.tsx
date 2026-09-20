import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatImage,
  ChatMessage,
  AgentMode,
  FileEditEvent,
  PermissionRequestEvent,
  CommandAutoRunEvent
} from '../types'
import Markdown from './Markdown'
import ThinkingIndicator from './ThinkingIndicator'
import {
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  PlusIcon,
  StopIcon
} from './Icons'
import FileTypeBadge from './FileTypeBadge'
import toolbarStripImage from '../assets/toolbar-strip.jpg'
import appLogo from '../assets/app-logo.png'
import DiffLinesView from './DiffLinesView'
import { diffLines, opsToDiffLines, diffStats } from '../lineDiff'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function dataUrl(img: ChatImage): string {
  return `data:${img.mimeType};base64,${img.data}`
}

function loadImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function fileToChatImage(file: File): Promise<ChatImage | null> {
  return new Promise((resolve) => {
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert(`That image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB).`)
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const result = reader.result
      if (typeof result !== 'string') {
        resolve(null)
        return
      }
      const match = result.match(/^data:([^;]+);base64,(.*)$/s)
      if (!match) {
        resolve(null)
        return
      }
      const dims = await loadImageDimensions(result)
      resolve({
        mimeType: match[1],
        data: match[2],
        name: file.name || 'image.png',
        width: dims?.width,
        height: dims?.height
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

interface Props {
  width: number
  rootFolder: string | null
  activeFileName: string | null
  activeFileContent: string | null
  onOpenFile: (path: string, line?: number) => void
  onOpenSettings: () => void
  forceIncludeSignal: number
  onFileChanged: (path: string) => void
  onFileRemoved: (path: string) => void
  onWorkspaceChanged: () => void
}

const GLOBAL_HISTORY_KEY = '__global__'

interface ContextFileRef {
  path: string
  relativePath: string
  truncated: boolean
}

interface DisplayFileEdit extends FileEditEvent {
  undone: boolean
}

type PermissionStatus = 'pending' | 'allowed' | 'denied'

interface DisplayPermissionRequest extends PermissionRequestEvent {
  status: PermissionStatus
  output?: string
  error?: boolean
}

interface DisplayMessage extends ChatMessage {
  displayContent?: string
  contextFiles?: ContextFileRef[]
  progressSteps?: string[]
  timestamp?: number
  fileEdits?: DisplayFileEdit[]
  permissionRequests?: DisplayPermissionRequest[]
  autoRuns?: CommandAutoRunEvent[]
  mode?: AgentMode
}

const MODE_RGB: Record<AgentMode, string> = {
  ask: '52, 211, 153',
  edit: '168, 85, 247',
  auto: '255, 140, 0'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="chat-message-copy-btn"
      title="Copy message"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
}

type Provider = 'openai' | 'ollama' | 'gemini'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function relativePath(root: string, filePath: string): string {
  return filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath
}

function withLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n')
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function FileEditCard({ edit, onUndo }: { edit: DisplayFileEdit; onUndo: () => void }): JSX.Element {
  const [open, setOpen] = useState(true)
  const ops = useMemo(() => diffLines(edit.oldContent ?? '', edit.newContent), [edit.oldContent, edit.newContent])
  const stats = useMemo(() => diffStats(ops), [ops])
  const isNew = edit.oldContent === null
  const fileName = edit.relativePath.split(/[/\\]/).pop() ?? edit.relativePath

  return (
    <div className="agent-edit-row">
      <div className="agent-edit-row-header" onClick={() => setOpen((v) => !v)}>
        <span className="agent-edit-chevron">{open ? '▾' : '▸'}</span>
        <FileTypeBadge fileName={fileName} />
        <span className="agent-edit-title" title={edit.relativePath}>
          {fileName}
        </span>
        {isNew && <span style={{ fontSize: 10, color: 'var(--success)' }}>new</span>}
        {stats.added > 0 && <span style={{ color: 'var(--success)', fontSize: 11 }}>+{stats.added}</span>}
        {stats.removed > 0 && <span style={{ color: 'var(--danger)', fontSize: 11 }}>−{stats.removed}</span>}
        {edit.undone ? (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>Undone</span>
        ) : (
          <button
            className="btn-secondary"
            style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto' }}
            onClick={(e) => {
              e.stopPropagation()
              onUndo()
            }}
          >
            Undo
          </button>
        )}
      </div>
      {open && (
        <div className="agent-edit-diff">
          <DiffLinesView lines={opsToDiffLines(ops)} context={2} fileName={fileName} />
        </div>
      )}
    </div>
  )
}

function PermissionCard({
  request,
  onRespond
}: {
  request: DisplayPermissionRequest
  onRespond: (allowed: boolean) => void
}): JSX.Element {
  return (
    <div className="agent-permission-card">
      <div className="agent-permission-title">🖥 Wants to run a terminal command</div>
      <pre className="agent-permission-command">{request.command}</pre>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>in {request.cwd}</div>
      {request.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ padding: '4px 12px' }} onClick={() => onRespond(true)}>
            Allow
          </button>
          <button className="btn-secondary" style={{ padding: '4px 12px' }} onClick={() => onRespond(false)}>
            Deny
          </button>
        </div>
      )}
      {request.status === 'allowed' && !request.output && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Running…</div>
      )}
      {request.status === 'denied' && (
        <div style={{ fontSize: 11, color: 'var(--danger)' }}>Denied — command was not run.</div>
      )}
      {request.output !== undefined && (
        <pre
          style={{
            marginTop: 6,
            padding: 8,
            fontSize: 11,
            fontFamily: 'Menlo, Consolas, monospace',
            background: 'var(--bg-editor)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            maxHeight: 180,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            color: request.error ? 'var(--danger)' : 'var(--text-primary)'
          }}
        >
          {request.output || '(no output)'}
        </pre>
      )}
    </div>
  )
}

function AutoRunCard({ run }: { run: CommandAutoRunEvent }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="agent-permission-card">
      <div className="agent-permission-title" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} 🖥 Ran automatically (read-only) — {run.error ? 'failed' : 'ok'}
      </div>
      <pre className="agent-permission-command" style={{ marginBottom: open ? 6 : 0 }}>
        {run.command}
      </pre>
      {open && (
        <pre
          style={{
            padding: 8,
            fontSize: 11,
            fontFamily: 'Menlo, Consolas, monospace',
            background: 'var(--bg-editor)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            maxHeight: 180,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            color: run.error ? 'var(--danger)' : 'var(--text-primary)'
          }}
        >
          {run.output || '(no output)'}
        </pre>
      )}
    </div>
  )
}

export default function ChatPanel({
  width,
  rootFolder,
  activeFileName,
  activeFileContent,
  onOpenFile,
  onOpenSettings,
  forceIncludeSignal,
  onFileChanged,
  onFileRemoved,
  onWorkspaceChanged
}: Props): JSX.Element {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [agentMode, setAgentMode] = useState<AgentMode>(() => {
    const saved = localStorage.getItem('llmraki-agent-mode')
    return saved === 'edit' || saved === 'auto' ? saved : 'ask'
  })
  const [conversationId, setConversationId] = useState<string>(() => makeId())
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([])
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchCodebase] = useState(true)
  const [includeFile, setIncludeFile] = useState(false)
  const [provider, setProvider] = useState<Provider>('ollama')
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean | null>(null)
  const [ollamaModel, setOllamaModel] = useState('llama3.2')
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash')
  const [modelSwitchNotice, setModelSwitchNotice] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [rateLimitWait, setRateLimitWait] = useState<number | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const historyMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const historyKey = rootFolder ?? GLOBAL_HISTORY_KEY
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    window.api.settings.getProvider().then(setProvider)
    window.api.settings.hasApiKey().then(setHasApiKey)
    window.api.settings.getOllamaModel().then(setOllamaModel)
    window.api.settings.hasGeminiKey().then(setHasGeminiKey)
    window.api.settings.getGeminiModel().then(setGeminiModel)
  }, [])

  useEffect(() => {
    if (forceIncludeSignal > 0) setIncludeFile(true)
  }, [forceIncludeSignal])

  useEffect(() => {
    localStorage.setItem('llmraki-agent-mode', agentMode)
  }, [agentMode])

  useEffect(() => {
    if (agentMode !== 'ask' && (provider !== 'gemini' || !rootFolder)) {
      setAgentMode('ask')
    }
  }, [provider, rootFolder, agentMode])

  useEffect(() => {
    if (!streaming) return
    setElapsedSeconds(0)
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [streaming])

  useEffect(() => {
    if (rateLimitWait === null) return
    if (rateLimitWait <= 0) {
      setRateLimitWait(null)
      return
    }
    const timer = setTimeout(() => setRateLimitWait((s) => (s === null ? null : s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [rateLimitWait])

  function refreshConversationList(): void {
    window.api.chatHistory.listConversations(historyKey).then(setConversationList)
  }

  useEffect(() => {
    let cancelled = false
    loadedRef.current = null
    window.api.chatHistory.listConversations(historyKey).then((list) => {
      if (cancelled) return
      setConversationList(list)
      if (list.length > 0 && rootFolder) {
        const mostRecent = list[0]
        window.api.chatHistory.getConversation(historyKey, mostRecent.id).then((loaded) => {
          if (cancelled) return
          setMessages(loaded as DisplayMessage[])
          setConversationId(mostRecent.id)
          loadedRef.current = `${historyKey}::${mostRecent.id}`
        })
      } else {
        const freshId = makeId()
        setMessages([])
        setConversationId(freshId)
        loadedRef.current = `${historyKey}::${freshId}`
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey])

  useEffect(() => {
    if (loadedRef.current !== `${historyKey}::${conversationId}`) return
    if (messages.length === 0) return
    const timeout = setTimeout(() => {
      window.api.chatHistory.saveConversation(historyKey, conversationId, messages)
    }, 400)
    return () => clearTimeout(timeout)
  }, [messages, historyKey, conversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node)) {
        setHistoryMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function startNewChat(): void {
    const freshId = makeId()
    setMessages([])
    setConversationId(freshId)
    loadedRef.current = `${historyKey}::${freshId}`
    setHistoryMenuOpen(false)
  }

  function beginRename(c: ConversationSummary): void {
    setRenamingId(c.id)
    setRenameValue(c.title)
  }

  function commitRename(): void {
    const id = renamingId
    const title = renameValue.trim()
    setRenamingId(null)
    if (!id || !title) return
    setConversationList((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    window.api.chatHistory.renameConversation(historyKey, id, title)
  }

  function loadConversation(id: string): void {
    window.api.chatHistory.getConversation(historyKey, id).then((loaded) => {
      setMessages(loaded as DisplayMessage[])
      setConversationId(id)
      loadedRef.current = `${historyKey}::${id}`
    })
    setHistoryMenuOpen(false)
  }

  function deleteConversation(id: string, e: React.MouseEvent): void {
    e.stopPropagation()
    window.api.chatHistory.deleteConversation(historyKey, id).then(refreshConversationList)
    if (id === conversationId) startNewChat()
  }

  async function handleSend(): Promise<void> {
    const trimmed = input.trim()
    if ((!trimmed && pendingImages.length === 0) || streaming) return
    const imagesToSend = pendingImages

    const currentProvider = await window.api.settings.getProvider()
    setProvider(currentProvider)

    if (currentProvider === 'openai') {
      const hasKey = await window.api.settings.hasApiKey()
      if (!hasKey) {
        setHasApiKey(false)
        return
      }
    }
    if (currentProvider === 'gemini') {
      const hasKey = await window.api.settings.hasGeminiKey()
      if (!hasKey) {
        setHasGeminiKey(false)
        return
      }
    }

    setInput('')
    setPendingImages([])
    setModelSwitchNotice(null)

    const useAgentLoop = currentProvider === 'gemini' && !!rootFolder && (searchCodebase || agentMode !== 'ask')

    const contextBlocks: string[] = []
    const contextFiles: ContextFileRef[] = []
    const seenPaths = new Set<string>()

    if (includeFile && activeFileName && activeFileContent !== null) {
      contextBlocks.push(
        `### File: ${activeFileName}\n\`\`\`\n${withLineNumbers(activeFileContent)}\n\`\`\``
      )
      contextFiles.push({ path: activeFileName, relativePath: activeFileName, truncated: false })
      seenPaths.add(activeFileName)
    }

    if (rootFolder && searchCodebase && !useAgentLoop) {
      setSearching(true)
      try {
        const found = await window.api.search.relevantFiles(rootFolder, trimmed)
        for (const f of found) {
          if (seenPaths.has(f.path)) continue
          seenPaths.add(f.path)
          const rel = relativePath(rootFolder, f.path)
          contextBlocks.push(
            `### File: ${rel}\n\`\`\`\n${withLineNumbers(f.content)}${f.truncated ? '\n… (truncated)' : ''}\n\`\`\``
          )
          contextFiles.push({ path: f.path, relativePath: rel, truncated: f.truncated })
        }
      } finally {
        setSearching(false)
      }
    }

    const citationInstruction =
      'When you reference specific code, cite the file inline in backticks as `relative/path/to/file.ext:LINE` ' +
      '(using the paths above) when you know the line number, or just `relative/path/to/file.ext` if not — ' +
      'this lets the app turn citations into clickable links. Each file above has its lines prefixed with ' +
      '`N: ` (real line numbers) so you always know exact line numbers — never guess or count them yourself. ' +
      'When quoting code in your answer, strip that `N: ` prefix so the shown code is clean, but whenever you ' +
      'show a multi-line excerpt taken directly from one of the files above (not a made-up example), make the ' +
      'very first line inside that fenced code block exactly `LOC_START:N` (no other text on that line), where ' +
      "N is the real line number of the excerpt's first actual code line — the app strips this marker and " +
      'numbers the rest of the excerpt to match the real file instead of always starting at 1.'

    const fullContent =
      contextBlocks.length > 0
        ? `Relevant project files:\n\n${contextBlocks.join('\n\n')}\n\n---\n\n${citationInstruction}\n\nQuestion: ${trimmed}`
        : trimmed

    const userMessage: DisplayMessage = {
      role: 'user',
      content: fullContent,
      displayContent: trimmed,
      contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
      timestamp: Date.now(),
      mode: agentMode
    }

    const history: ChatMessage[] = messages.map(({ role, content, images }) => ({
      role,
      content,
      images
    }))
    const nextMessagesForApi: ChatMessage[] = [
      ...history,
      { role: 'user', content: fullContent, images: imagesToSend.length > 0 ? imagesToSend : undefined }
    ]

    setMessages((prev) => [
      ...prev,
      userMessage,
      { role: 'assistant', content: '', timestamp: Date.now() }
    ])
    setStreaming(true)

    const requestId = makeId()
    requestIdRef.current = requestId

    const offChunk = window.api.ai.onChunk(requestId, (chunk) => {
      setRateLimitWait(null)
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') {
          copy[copy.length - 1] = { ...last, content: last.content + chunk }
        }
        return copy
      })
    })
    const offDone = window.api.ai.onDone(requestId, () => {
      setRateLimitWait(null)
      setStreaming(false)
      cleanup()
      refreshConversationList()
    })
    const offError = window.api.ai.onError(requestId, (message) => {
      setRateLimitWait(null)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `⚠️ ${message}`, timestamp: Date.now() }
      ])
      setStreaming(false)
      cleanup()
      refreshConversationList()
    })
    const offModelSwitched = window.api.ai.onModelSwitched(requestId, (switchedModel) => {
      setModelSwitchNotice(
        `Your selected model wasn't available right now — automatically switched to "${switchedModel}" for this reply.`
      )
    })
    const offRateLimited = window.api.ai.onRateLimited(requestId, (waitSeconds) => {
      setRateLimitWait(waitSeconds)
    })
    const offProgress = window.api.ai.onProgress(requestId, (label) => {
      setRateLimitWait(null)
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') {
          copy[copy.length - 1] = { ...last, progressSteps: [...(last.progressSteps ?? []), label] }
        }
        return copy
      })
    })
    const offFileEdit = window.api.ai.onFileEdit(requestId, (edit) => {
      onFileChanged(edit.path)
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            fileEdits: [...(last.fileEdits ?? []), { ...edit, undone: false }]
          }
        }
        return copy
      })
    })
    const offPermissionRequest = window.api.ai.onPermissionRequest(requestId, (req) => {
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            permissionRequests: [...(last.permissionRequests ?? []), { ...req, status: 'pending' }]
          }
        }
        return copy
      })
    })
    const offCommandResult = window.api.ai.onCommandResult(requestId, (result) => {
      onWorkspaceChanged()
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant' && last.permissionRequests) {
          copy[copy.length - 1] = {
            ...last,
            permissionRequests: last.permissionRequests.map((r) =>
              r.permissionId === result.permissionId
                ? { ...r, output: result.output, error: result.error }
                : r
            )
          }
        }
        return copy
      })
    })

    const offCommandAutoRun = window.api.ai.onCommandAutoRun(requestId, (run) => {
      onWorkspaceChanged()
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') {
          copy[copy.length - 1] = { ...last, autoRuns: [...(last.autoRuns ?? []), run] }
        }
        return copy
      })
    })

    function cleanup(): void {
      offChunk()
      offDone()
      offError()
      offModelSwitched()
      offRateLimited()
      offProgress()
      offFileEdit()
      offPermissionRequest()
      offCommandResult()
      offCommandAutoRun()
    }

    if (currentProvider === 'ollama') {
      const model = await window.api.settings.getOllamaModel()
      await window.api.ollama.sendMessage(requestId, model, nextMessagesForApi)
    } else if (currentProvider === 'gemini') {
      await window.api.gemini.sendMessage(
        requestId,
        nextMessagesForApi,
        useAgentLoop ? rootFolder : null,
        agentMode
      )
    } else {
      await window.api.ai.sendMessage(requestId, nextMessagesForApi)
    }
  }

  function handleCancel(): void {
    if (requestIdRef.current) {
      if (provider === 'ollama') {
        window.api.ollama.cancel(requestIdRef.current)
      } else if (provider === 'gemini') {
        window.api.gemini.cancel(requestIdRef.current)
      } else {
        window.api.ai.cancel(requestIdRef.current)
      }
    }
    setStreaming(false)
    setRateLimitWait(null)
  }

  async function handleUndoEdit(messageIndex: number, editIndex: number): Promise<void> {
    const edit = messages[messageIndex]?.fileEdits?.[editIndex]
    if (!edit) return
    try {
      if (edit.oldContent === null) {
        await window.api.fs.delete(edit.path, false)
        onFileRemoved(edit.path)
      } else {
        await window.api.fs.writeFile(edit.path, edit.oldContent)
        onFileChanged(edit.path)
      }
      setMessages((prev) => {
        const copy = [...prev]
        const msg = copy[messageIndex]
        if (!msg?.fileEdits) return prev
        const edits = msg.fileEdits.map((e, i) => (i === editIndex ? { ...e, undone: true } : e))
        copy[messageIndex] = { ...msg, fileEdits: edits }
        return copy
      })
    } catch (err) {
      window.alert(`Couldn't undo the edit: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleUndoAllEdits(messageIndex: number): Promise<void> {
    const edits = messages[messageIndex]?.fileEdits ?? []
    // Undo in reverse order so a file edited more than once each step rewinds one change instead of reapplying an already-undone snapshot.
    for (let idx = edits.length - 1; idx >= 0; idx--) {
      if (edits[idx].undone) continue
      await handleUndoEdit(messageIndex, idx)
    }
  }

  function handleRespondPermission(messageIndex: number, permissionId: string, allowed: boolean): void {
    window.api.ai.respondPermission(permissionId, allowed)
    setMessages((prev) => {
      const copy = [...prev]
      const msg = copy[messageIndex]
      if (!msg?.permissionRequests) return prev
      const requests = msg.permissionRequests.map((r) =>
        r.permissionId === permissionId ? { ...r, status: allowed ? ('allowed' as const) : ('denied' as const) } : r
      )
      copy[messageIndex] = { ...msg, permissionRequests: requests }
      return copy
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (items.length === 0) return
    e.preventDefault()
    const files = items.map((item) => item.getAsFile()).filter((f): f is File => f !== null)
    const images = await Promise.all(files.map(fileToChatImage))
    const valid = images.filter((img): img is ChatImage => img !== null)
    if (valid.length > 0) {
      setPendingImages((prev) => [...prev, ...valid])
    }
  }

  function removePendingImage(index: number): void {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleAttachFiles(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const images = await Promise.all(files.map(fileToChatImage))
    const valid = images.filter((img): img is ChatImage => img !== null)
    if (valid.length > 0) setPendingImages((prev) => [...prev, ...valid])
  }

  const busy = streaming || searching

  return (
    <div className="chat-panel" data-mode={agentMode} style={{ width }}>
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }} ref={historyMenuRef}>
            <button
              className="btn-secondary"
              style={{ padding: '2px 7px', fontSize: 12 }}
              title="Chat history"
              onClick={() => {
                if (!historyMenuOpen) refreshConversationList()
                setHistoryMenuOpen((v) => !v)
              }}
            >
              🕘
            </button>
            {historyMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 26,
                  left: 0,
                  width: 260,
                  maxHeight: 320,
                  overflowY: 'auto',
                  background: 'var(--overlay-bg)',
                  backdropFilter: 'blur(28px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 10,
                  boxShadow: 'var(--shadow-float)',
                  zIndex: 200,
                  textAlign: 'left'
                }}
              >
                {conversationList.length === 0 && (
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    No past conversations {rootFolder ? 'for this project' : ''} yet.
                  </div>
                )}
                {conversationList.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => renamingId !== c.id && loadConversation(c.id)}
                    className={`tree-item ${c.id === conversationId ? 'selected' : ''}`}
                    style={{ alignItems: 'flex-start', padding: '8px 10px' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renamingId === c.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          style={{
                            width: '100%',
                            fontSize: 12,
                            background: 'var(--bg-input)',
                            border: '1px solid var(--accent-bright)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            padding: '1px 4px'
                          }}
                        />
                      ) : (
                        <div
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            beginRename(c)
                          }}
                          title="Double-click to rename"
                          style={{
                            fontSize: 12,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {c.title}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(c.updatedAt)}</div>
                    </div>
                    <button
                      className="close-btn"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation()
                        beginRename(c)
                      }}
                    >
                      ✎
                    </button>
                    <button className="close-btn" title="Delete" onClick={(e) => deleteConversation(c.id, e)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span>AI Chat</span>
        </div>
        <button
          className="btn-secondary"
          style={{ padding: '2px 7px', fontSize: 12 }}
          title="New chat"
          onClick={startNewChat}
        >
          +
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !rootFolder && conversationList.length > 0 && (
          <div className="chat-recent-list chat-recent-list-top">
            <div className="chat-recent-heading">
              <ClockIcon /> Recent chats
            </div>
            {conversationList.slice(0, 5).map((c) => (
              <div key={c.id} onClick={() => loadConversation(c.id)} className="chat-recent-item">
                <div className="chat-recent-item-title">{c.title}</div>
                <div className="chat-recent-item-time">{timeAgo(c.updatedAt)}</div>
              </div>
            ))}
          </div>
        )}
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-brand">
              <img src={appLogo} alt="LLMRaki" className="chat-empty-logo" />
              <div className="chat-empty-title">LLMRaki</div>
              <div className="chat-empty-greeting">Welcome Back</div>
            </div>
            <div className="chat-message system-note">
              Ask about your code, request a refactor, or paste an error message.
              {rootFolder &&
                (provider === 'gemini'
                  ? ' Gemini can search and read files from your project on its own as it answers.'
                  : ' Relevant files from your project are found and included automatically.')}
            </div>
          </div>
        )}
        {modelSwitchNotice && (
          <div className="chat-message system-note" style={{ color: '#e0a030' }}>
            ⚠️ {modelSwitchNotice}
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1
          const readCount = m.progressSteps?.filter((s) => s.startsWith('Read')).length ?? 0
          const searchCount = m.progressSteps?.filter((s) => s.startsWith('Searched')).length ?? 0
          const msgModeStyle =
            m.role === 'user' && m.mode
              ? ({ '--msg-mode-rgb': MODE_RGB[m.mode] } as React.CSSProperties)
              : undefined
          return (
            <div
              key={i}
              className={`chat-message ${m.role === 'user' ? 'user' : 'assistant'}`}
              style={msgModeStyle}
            >
              {m.images && m.images.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
                  {m.images.map((img, idx) => (
                    <div key={idx}>
                      <img src={dataUrl(img)} alt={img.name ?? 'Attached'} className="chat-image-attachment" />
                      {(img.name || (img.width && img.height)) && (
                        <div className="chat-image-caption">
                          🖼 {img.name ?? 'image'}
                          {img.width && img.height && ` ${img.width}×${img.height}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {m.contextFiles && m.contextFiles.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    marginBottom: 6,
                    paddingBottom: 6,
                    borderBottom: '1px solid rgba(255,255,255,0.2)'
                  }}
                >
                  {m.contextFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => onOpenFile(f.path)}
                      title={f.relativePath}
                      style={{
                        background: 'rgba(255,255,255,0.15)',
                        border: 'none',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 10,
                        color: 'inherit',
                        cursor: 'pointer'
                      }}
                    >
                      📎 {f.relativePath.split(/[/\\]/).pop()}
                    </button>
                  ))}
                </div>
              )}
              {m.progressSteps && m.progressSteps.length > 0 && (
                <details className="chat-progress">
                  <summary>
                    {isLast && streaming ? (
                      <span key={m.progressSteps.length} className="chat-progress-live">
                        {m.progressSteps[m.progressSteps.length - 1]}
                      </span>
                    ) : (
                      <>
                        Explored{' '}
                        <span className="chat-progress-muted">
                          {readCount} file{readCount === 1 ? '' : 's'}, {searchCount} search
                          {searchCount === 1 ? '' : 'es'}
                        </span>
                      </>
                    )}
                  </summary>
                  <div className="chat-progress-steps">
                    {m.progressSteps.map((s, idx) => (
                      <div key={idx}>{s}</div>
                    ))}
                  </div>
                </details>
              )}
              {m.fileEdits && m.fileEdits.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                  <div className="agent-edit-summary-bar">
                    <span>
                      {m.fileEdits.length} File{m.fileEdits.length === 1 ? '' : 's'}
                    </span>
                    {m.fileEdits.some((e) => !e.undone) && (
                      <button className="btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => handleUndoAllEdits(i)}>
                        Undo All
                      </button>
                    )}
                  </div>
                  {m.fileEdits.map((edit, editIdx) => (
                    <FileEditCard key={editIdx} edit={edit} onUndo={() => handleUndoEdit(i, editIdx)} />
                  ))}
                </div>
              )}
              {m.permissionRequests && m.permissionRequests.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {m.permissionRequests.map((req, reqIdx) => (
                    <PermissionCard
                      key={req.permissionId ?? reqIdx}
                      request={req}
                      onRespond={(allowed) => handleRespondPermission(i, req.permissionId, allowed)}
                    />
                  ))}
                </div>
              )}
              {m.autoRuns && m.autoRuns.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {m.autoRuns.map((run, runIdx) => (
                    <AutoRunCard key={runIdx} run={run} />
                  ))}
                </div>
              )}
              {m.role === 'assistant' ? (
                m.content ? (
                  <Markdown content={m.content} rootFolder={rootFolder} onOpenFile={onOpenFile} />
                ) : streaming && isLast ? (
                  <ThinkingIndicator
                    label={
                      m.progressSteps && m.progressSteps.length > 0
                        ? m.progressSteps[m.progressSteps.length - 1]
                        : 'Thinking'
                    }
                  />
                ) : null
              ) : (
                (m.displayContent ?? m.content)
              )}
              {m.timestamp && (m.content || m.role === 'user') && (
                <div className="chat-message-meta">
                  <span className="chat-message-time">{formatTime(m.timestamp)}</span>
                  <CopyButton text={m.displayContent ?? m.content} />
                </div>
              )}
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {provider === 'openai' && hasApiKey === false && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 6 }}>
            No API key set. Add your OpenAI key in Settings, or switch the provider to Gemini or
            Ollama for a free option.
          </div>
        )}
        {provider === 'gemini' && hasGeminiKey === false && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 6 }}>
            No Gemini API key set. Add one in Settings (aistudio.google.com/apikey).
          </div>
        )}

        <div className="chat-composer-card">
        {(pendingImages.length > 0 || includeFile) && (
          <div className="chat-attachments-row">
            {includeFile && activeFileName && (
              <div className="chat-attachment-chip">
                <FileTypeBadge fileName={activeFileName} />
                <span>{activeFileName}</span>
                <button title="Remove" onClick={() => setIncludeFile(false)}>
                  <CloseIcon />
                </button>
              </div>
            )}
            {pendingImages.map((img, i) => (
              <div key={i} className="chat-attachment-chip">
                🖼
                <span>
                  {img.name ?? 'image'}
                  {img.width && img.height && ` ${img.width}×${img.height}`}
                </span>
                <button title="Remove" onClick={() => removePendingImage(i)}>
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          placeholder="Message the assistant… (Enter to send, Shift+Enter for newline, paste an image)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        {rateLimitWait !== null ? (
          <div className="chat-status-line rate-limit-pulse" style={{ color: '#e0a030' }}>
            ⏳ Rate limit reached — waiting {rateLimitWait}s for it to reset, then retrying automatically…
          </div>
        ) : (
          (searching || (streaming && !elapsedSeconds)) && (
            <div className="chat-status-line">
              <ThinkingIndicator label={searching ? 'Searching codebase' : 'Generating'} />
            </div>
          )
        )}

        <div
          className="chat-toolbar chat-toolbar-strip"
          style={{
            backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url(${toolbarStripImage})`
          }}
        >
          <div className="chat-toolbar-group">
            <div className="agent-mode-row">
              {(['ask', 'edit', 'auto'] as AgentMode[]).map((m) => {
                const disabled = m !== 'ask' && (provider !== 'gemini' || !rootFolder)
                return (
                  <button
                    key={m}
                    className={`agent-mode-btn ${agentMode === m ? 'active' : ''}`}
                    disabled={disabled}
                    title={
                      disabled
                        ? 'Edit and Auto mode need Gemini with a project folder open'
                        : m === 'ask'
                          ? 'Ask: read-only, no file or terminal changes'
                          : m === 'edit'
                            ? 'Edit: applies file edits directly (with undo) — terminal commands always ask permission'
                            : 'Auto: edits multiple files without pausing — terminal commands always ask permission'
                    }
                    onClick={() => setAgentMode(m)}
                  >
                    {m === 'ask' ? 'Ask' : m === 'edit' ? 'Edit' : 'Auto'}
                  </button>
                )
              })}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleAttachFiles}
            />
            <button
              className="chat-toolbar-icon-btn"
              title="Attach image"
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusIcon />
            </button>
            {activeFileName && (
              <button
                className={`chat-toolbar-icon-btn ${includeFile ? 'active' : ''}`}
                title={`Include "${activeFileName}" as context`}
                onClick={() => setIncludeFile((v) => !v)}
              >
                <FileIcon />
              </button>
            )}
          </div>
          <div className="chat-toolbar-group chat-toolbar-group-end">
            {streaming && (
              <span className="chat-toolbar-status">
                <ClockIcon /> {elapsedSeconds}s
              </span>
            )}
            <button className="chat-model-pill" onClick={onOpenSettings} title="Change AI provider or model">
              {provider === 'ollama' && `Ollama · ${ollamaModel}`}
              {provider === 'gemini' && `Gemini · ${geminiModel}`}
              {provider === 'openai' && 'OpenAI'}
            </button>
            {streaming ? (
              <button className="chat-send-btn stop" onClick={handleCancel} title="Stop">
                <StopIcon />
              </button>
            ) : (
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={(!input.trim() && pendingImages.length === 0) || busy}
                title="Send"
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
