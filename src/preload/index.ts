import { contextBridge, ipcRenderer } from 'electron'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface OpenFolderResult {
  root: string
  entries: FileEntry[]
}

export interface ChatImage {
  mimeType: string
  data: string
  name?: string
  width?: number
  height?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: ChatImage[]
}

export interface GitFileChange {
  path: string
  index: string
  workingTree: string
  staged: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
  parents: string[]
  refs: string[]
}

export interface TextSearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
}

export interface SearchMatch {
  file: string
  line: number
  preview: string
  matchStart: number
  matchLength: number
}

export interface RelevantFile {
  path: string
  score: number
  content: string
  truncated: boolean
}

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
}

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

export type AgentMode = 'ask' | 'edit' | 'auto'

export interface FileEditEvent {
  path: string
  relativePath: string
  oldContent: string | null
  newContent: string
}

export interface PermissionRequestEvent {
  permissionId: string
  command: string
  cwd: string
}

export interface CommandResultEvent {
  permissionId: string
  command: string
  output: string
  error: boolean
}

export interface CommandAutoRunEvent {
  command: string
  output: string
  error: boolean
}

const api = {
  fs: {
    openFolder: (): Promise<OpenFolderResult | null> => ipcRenderer.invoke('fs:openFolder'),
    openFolderAtPath: (folderPath: string): Promise<OpenFolderResult | null> =>
      ipcRenderer.invoke('fs:openFolderAtPath', folderPath),
    readDir: (dirPath: string): Promise<FileEntry[]> => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    createFile: (dirPath: string, name: string): Promise<string> =>
      ipcRenderer.invoke('fs:createFile', dirPath, name),
    createFolder: (dirPath: string, name: string): Promise<string> =>
      ipcRenderer.invoke('fs:createFolder', dirPath, name),
    showSaveDialog: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('fs:showSaveDialog', defaultPath),
    rename: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    delete: (targetPath: string, isDirectory: boolean): Promise<void> =>
      ipcRenderer.invoke('fs:delete', targetPath, isDirectory),
    revealInFinder: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:revealInFinder', targetPath),
    openInDefaultApp: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:openInDefaultApp', targetPath),
    copy: (sourcePath: string, destDir: string): Promise<string> =>
      ipcRenderer.invoke('fs:copy', sourcePath, destDir)
  },
  settings: {
    hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
    setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', key),
    clearApiKey: (): Promise<void> => ipcRenderer.invoke('settings:clearApiKey'),
    getModel: (): Promise<string> => ipcRenderer.invoke('settings:getModel'),
    setModel: (model: string): Promise<void> => ipcRenderer.invoke('settings:setModel', model),
    getProvider: (): Promise<'openai' | 'ollama' | 'gemini'> =>
      ipcRenderer.invoke('settings:getProvider'),
    setProvider: (provider: 'openai' | 'ollama' | 'gemini'): Promise<void> =>
      ipcRenderer.invoke('settings:setProvider', provider),
    getOllamaModel: (): Promise<string> => ipcRenderer.invoke('settings:getOllamaModel'),
    setOllamaModel: (model: string): Promise<void> =>
      ipcRenderer.invoke('settings:setOllamaModel', model),
    hasGeminiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasGeminiKey'),
    setGeminiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:setGeminiKey', key),
    clearGeminiKey: (): Promise<void> => ipcRenderer.invoke('settings:clearGeminiKey'),
    getGeminiModel: (): Promise<string> => ipcRenderer.invoke('settings:getGeminiModel'),
    setGeminiModel: (model: string): Promise<void> =>
      ipcRenderer.invoke('settings:setGeminiModel', model),
    getRecentFolders: (): Promise<RecentFolder[]> => ipcRenderer.invoke('settings:getRecentFolders'),
    removeRecentFolder: (folderPath: string): Promise<RecentFolder[]> =>
      ipcRenderer.invoke('settings:removeRecentFolder', folderPath),
    clearRecentFolders: (): Promise<void> => ipcRenderer.invoke('settings:clearRecentFolders')
  },
  ai: {
    sendMessage: (requestId: string, messages: ChatMessage[]): Promise<void> =>
      ipcRenderer.invoke('ai:sendMessage', requestId, messages),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke('ai:cancel', requestId),
    onChunk: (requestId: string, cb: (chunk: string) => void) => {
      const channel = `ai:chunk:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, chunk: string) => cb(chunk)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onDone: (requestId: string, cb: () => void) => {
      const channel = `ai:done:${requestId}`
      const listener = () => cb()
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onError: (requestId: string, cb: (message: string) => void) => {
      const channel = `ai:error:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, message: string) => cb(message)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onModelSwitched: (requestId: string, cb: (model: string) => void) => {
      const channel = `ai:modelSwitched:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, model: string) => cb(model)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onProgress: (requestId: string, cb: (label: string) => void) => {
      const channel = `ai:progress:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, label: string) => cb(label)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onRateLimited: (requestId: string, cb: (waitSeconds: number) => void) => {
      const channel = `ai:rateLimited:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, waitSeconds: number) => cb(waitSeconds)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onFileEdit: (requestId: string, cb: (edit: FileEditEvent) => void) => {
      const channel = `ai:fileEdit:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, edit: FileEditEvent) => cb(edit)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onPermissionRequest: (requestId: string, cb: (req: PermissionRequestEvent) => void) => {
      const channel = `ai:permissionRequest:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, req: PermissionRequestEvent) => cb(req)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onCommandResult: (requestId: string, cb: (result: CommandResultEvent) => void) => {
      const channel = `ai:commandResult:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, result: CommandResultEvent) => cb(result)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onCommandAutoRun: (requestId: string, cb: (result: CommandAutoRunEvent) => void) => {
      const channel = `ai:commandAutoRun:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, result: CommandAutoRunEvent) => cb(result)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    respondPermission: (permissionId: string, allowed: boolean): Promise<void> =>
      ipcRenderer.invoke('agent:respondPermission', permissionId, allowed)
  },
  ollama: {
    sendMessage: (requestId: string, model: string, messages: ChatMessage[]): Promise<void> =>
      ipcRenderer.invoke('ollama:sendMessage', requestId, model, messages),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke('ollama:cancel', requestId),
    listModels: (): Promise<string[]> => ipcRenderer.invoke('ollama:listModels')
  },
  gemini: {
    sendMessage: (
      requestId: string,
      messages: ChatMessage[],
      rootFolder?: string | null,
      mode?: AgentMode
    ): Promise<void> => ipcRenderer.invoke('gemini:sendMessage', requestId, messages, rootFolder, mode),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke('gemini:cancel', requestId),
    listModels: (): Promise<GeminiModelInfo[]> => ipcRenderer.invoke('gemini:listModels'),
    checkAvailability: (models: string[]): Promise<GeminiAvailability[]> =>
      ipcRenderer.invoke('gemini:checkAvailability', models)
  },
  git: {
    findRoot: (root: string): Promise<string | null> => ipcRenderer.invoke('git:findRoot', root),
    status: (root: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', root),
    diff: (root: string, filePath: string, staged: boolean): Promise<string> =>
      ipcRenderer.invoke('git:diff', root, filePath, staged),
    stage: (root: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke('git:stage', root, filePath),
    unstage: (root: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke('git:unstage', root, filePath),
    discard: (root: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke('git:discard', root, filePath),
    stageAll: (root: string): Promise<void> => ipcRenderer.invoke('git:stageAll', root),
    commit: (root: string, message: string): Promise<void> =>
      ipcRenderer.invoke('git:commit', root, message),
    push: (root: string): Promise<void> => ipcRenderer.invoke('git:push', root),
    pull: (root: string): Promise<void> => ipcRenderer.invoke('git:pull', root),
    log: (root: string, limit?: number): Promise<GitCommit[]> =>
      ipcRenderer.invoke('git:log', root, limit),
    show: (root: string, hash: string): Promise<string> => ipcRenderer.invoke('git:show', root, hash)
  },
  search: {
    listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('search:listFiles', root),
    text: (root: string, query: string, options?: TextSearchOptions): Promise<SearchMatch[]> =>
      ipcRenderer.invoke('search:text', root, query, options),
    relevantFiles: (root: string, query: string): Promise<RelevantFile[]> =>
      ipcRenderer.invoke('search:relevantFiles', root, query)
  },
  terminal: {
    create: (id: string, cwd: string | null): Promise<void> =>
      ipcRenderer.invoke('terminal:create', id, cwd),
    write: (id: string, data: string): Promise<void> => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('terminal:kill', id),
    onData: (id: string, cb: (data: string) => void) => {
      const channel = `terminal:data:${id}`
      const listener = (_e: Electron.IpcRendererEvent, data: string) => cb(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id: string, cb: () => void) => {
      const channel = `terminal:exit:${id}`
      const listener = () => cb()
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  menu: {
    onAction: (cb: (action: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, action: string) => cb(action)
      ipcRenderer.on('menu:action', listener)
      return () => ipcRenderer.removeListener('menu:action', listener)
    }
  },
  chatHistory: {
    listConversations: (key: string): Promise<ConversationSummary[]> =>
      ipcRenderer.invoke('chatHistory:listConversations', key),
    getConversation: (key: string, id: string): Promise<unknown[]> =>
      ipcRenderer.invoke('chatHistory:getConversation', key, id),
    saveConversation: (key: string, id: string, messages: unknown[]): Promise<void> =>
      ipcRenderer.invoke('chatHistory:saveConversation', key, id, messages),
    deleteConversation: (key: string, id: string): Promise<void> =>
      ipcRenderer.invoke('chatHistory:deleteConversation', key, id),
    renameConversation: (key: string, id: string, title: string): Promise<void> =>
      ipcRenderer.invoke('chatHistory:renameConversation', key, id, title)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
