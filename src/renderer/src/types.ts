export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface OpenTab {
  // Tab identity — unique per tab. Equals `path` for a plain open, or `${path}::workingtree`
  // for the diff view, so the same file can be open as two independent, coexisting tabs.
  id: string
  path: string
  name: string
  content: string
  savedContent: string
  isDirty: boolean
  isUntitled: boolean
  diffMode?: boolean
}

export interface DiffTab {
  id: string
  gitRoot: string
  relPath: string
  name: string
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

export type SidebarView = 'explorer' | 'search' | 'sourceControl' | 'run' | 'extensions' | 'settings'

interface GitFileChange {
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

export interface BlameLine {
  line: number
  hash: string
  author: string
  authorTime: number
  summary: string
}

export interface SearchMatch {
  file: string
  line: number
  preview: string
  matchStart: number
  matchLength: number
}

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

export const WELCOME_TAB_ID = '__welcome__'

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

export interface CommandAutoRunEvent {
  command: string
  output: string
  error: boolean
}
