import { useCallback, useEffect, useRef, useState } from 'react'
import ActivityBar from './components/ActivityBar'
import FileExplorer from './components/FileExplorer'
import SearchPanel from './components/SearchPanel'
import SourceControlPanel from './components/SourceControlPanel'
import RunPanel from './components/RunPanel'
import ExtensionsPanel from './components/ExtensionsPanel'
import SettingsPanel from './components/SettingsPanel'
import EditorArea from './components/EditorArea'
import ChatPanel from './components/ChatPanel'
import StatusBar from './components/StatusBar'
import BottomPanel from './components/BottomPanel'
import TopSearchBar from './components/TopSearchBar'
import QuickOpen from './components/QuickOpen'
import CommandPalette, { Command } from './components/CommandPalette'
import ContextMenu, { ContextMenuEntry } from './components/ContextMenu'
import InputModal from './components/InputModal'
import { languageForFile } from './utils/language'
import { loadProjectContext } from './projectIntelliSense'
import { setDefinitionOpenHandler } from './monacoEditorOpener'
import { useDebuggerSession } from './useDebugger'
import { SidebarView, FileEntry, OpenTab, DiffTab, GitStatus, RecentFolder, WELCOME_TAB_ID } from './types'
import appLogo from './assets/app-logo.png'

const COMMANDS: Command[] = [
  { id: 'show-welcome', label: 'Help: Welcome' },
  { id: 'new-file', label: 'File: New File' },
  { id: 'open-folder', label: 'File: Open Folder…' },
  { id: 'save-file', label: 'File: Save' },
  { id: 'save-file-as', label: 'File: Save As…' },
  { id: 'close-tab', label: 'File: Close Editor' },
  { id: 'format-document', label: 'Format Document' },
  { id: 'goto-definition', label: 'Go to Definition' },
  { id: 'find-references', label: 'Find All References' },
  { id: 'ai-edit-selection', label: 'AI: Edit Selection (⌘K)' },
  { id: 'view-explorer', label: 'View: Show Explorer' },
  { id: 'open-search', label: 'View: Show Search' },
  { id: 'view-source-control', label: 'View: Show Source Control' },
  { id: 'view-run', label: 'View: Show Run and Debug' },
  { id: 'view-extensions', label: 'View: Show Extensions' },
  { id: 'toggle-sidebar', label: 'View: Toggle Sidebar Visibility' },
  { id: 'toggle-panel', label: 'View: Toggle Panel' },
  { id: 'toggle-chat', label: 'View: Toggle AI Chat' },
  { id: 'new-terminal', label: 'Terminal: Create New Terminal' },
  { id: 'open-settings', label: 'Preferences: Open Settings' }
]

let untitledCounter = 0

// A tab's identity is its `id`, not its `path` — the same file can be open as two independent,
// coexisting tabs (a plain view and a "Working Tree" diff view), sharing a path but not an id.
function tabIdFor(path: string, diffMode?: boolean): string {
  return diffMode ? `${path}::workingtree` : path
}

export default function App(): JSX.Element {
  const [booting, setBooting] = useState(true)
  const [sidebarView, setSidebarView] = useState<SidebarView | null>(null)
  const [rootFolder, setRootFolder] = useState<string | null>(null)
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([])
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [diffTabs, setDiffTabs] = useState<DiffTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(WELCOME_TAB_ID)
  const [showWelcomeTab, setShowWelcomeTab] = useState(true)
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([])
  const [chatOpen, setChatOpen] = useState(true)
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem('llmraki-chat-width')
    const parsed = saved ? parseInt(saved, 10) : NaN
    return Number.isFinite(parsed) ? parsed : 380
  })
  const chatWidthRef = useRef(chatPanelWidth)
  const chatDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('llmraki-sidebar-width')
    const parsed = saved ? parseInt(saved, 10) : NaN
    return Number.isFinite(parsed) ? parsed : 260
  })
  const sidebarWidthRef = useRef(sidebarWidth)
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleSidebarResizeMove = useCallback((e: MouseEvent) => {
    const drag = sidebarDragRef.current
    if (!drag) return
    const delta = e.clientX - drag.startX
    const maxWidth = Math.max(260, window.innerWidth - 500)
    const newWidth = Math.min(maxWidth, Math.max(180, drag.startWidth + delta))
    sidebarWidthRef.current = newWidth
    setSidebarWidth(newWidth)
  }, [])

  const handleSidebarResizeEnd = useCallback(() => {
    sidebarDragRef.current = null
    document.removeEventListener('mousemove', handleSidebarResizeMove)
    document.removeEventListener('mouseup', handleSidebarResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem('llmraki-sidebar-width', String(sidebarWidthRef.current))
  }, [handleSidebarResizeMove])

  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidthRef.current }
      document.addEventListener('mousemove', handleSidebarResizeMove)
      document.addEventListener('mouseup', handleSidebarResizeEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [handleSidebarResizeMove, handleSidebarResizeEnd]
  )

  const handleChatResizeMove = useCallback((e: MouseEvent) => {
    const drag = chatDragRef.current
    if (!drag) return
    const delta = drag.startX - e.clientX
    const maxWidth = Math.max(320, window.innerWidth - 500)
    const newWidth = Math.min(maxWidth, Math.max(280, drag.startWidth + delta))
    chatWidthRef.current = newWidth
    setChatPanelWidth(newWidth)
  }, [])

  const handleChatResizeEnd = useCallback(() => {
    chatDragRef.current = null
    document.removeEventListener('mousemove', handleChatResizeMove)
    document.removeEventListener('mouseup', handleChatResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem('llmraki-chat-width', String(chatWidthRef.current))
  }, [handleChatResizeMove])

  const handleChatResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      chatDragRef.current = { startX: e.clientX, startWidth: chatWidthRef.current }
      document.addEventListener('mousemove', handleChatResizeMove)
      document.addEventListener('mouseup', handleChatResizeEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [handleChatResizeMove, handleChatResizeEnd]
  )

  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [gitRefreshToken, setGitRefreshToken] = useState(0)

  const [bottomPanelVisible, setBottomPanelVisible] = useState(false)
  const [panelMaximized, setPanelMaximized] = useState(false)
  const [bottomPanelTab, setBottomPanelTab] = useState<'problems' | 'output' | 'debug' | 'terminal' | 'ports'>('terminal')
  const [newTerminalSignal, setNewTerminalSignal] = useState(0)
  const [editorActionSignal, setEditorActionSignal] = useState<{
    type: 'format' | 'goto-definition' | 'find-references' | 'inline-edit'
    token: number
  } | null>(null)
  const [openTerminalAt, setOpenTerminalAt] = useState<string | null>(null)
  const [runCommand, setRunCommand] = useState<string | null>(null)
  const debuggerSession = useDebuggerSession()

  const [quickOpenVisible, setQuickOpenVisible] = useState(false)
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false)

  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null)
  const [revealTarget, setRevealTarget] = useState<{ path: string; line: number } | null>(null)

  const [contextMenu, setContextMenu] = useState<{ entry: FileEntry; x: number; y: number } | null>(
    null
  )
  const [inputModal, setInputModal] = useState<{
    title: string
    initialValue?: string
    confirmLabel?: string
    onSubmit: (value: string) => void
  } | null>(null)
  const [clipboardEntry, setClipboardEntry] = useState<{
    path: string
    isDirectory: boolean
    mode: 'copy' | 'cut'
  } | null>(null)
  const [treeRefreshToken, setTreeRefreshToken] = useState(0)
  const [chatIncludeSignal, setChatIncludeSignal] = useState(0)

  const activeTab = tabs.find((t) => t.id === activePath) ?? null

  // Reassigned every render (not registered once in an effect) so it always closes over the
  // current `openFileByPath` — standalone Monaco's "Go to Definition" has no built-in notion of
  // switching files, so this is what makes jumping to a definition in a different file work.
  setDefinitionOpenHandler((path, line) => {
    openFileByPath(path, line)
  })

  function refreshRecents(): void {
    window.api.settings.getRecentFolders().then(setRecentFolders)
  }

  useEffect(() => {
    refreshRecents()
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    window.api.fs.watchRoot(rootFolder)
  }, [rootFolder])

  // Gives Monaco's TypeScript worker real project context (tsconfig, cross-file imports,
  // dependency types) — without this, autocomplete only ever sees whichever single file is
  // open. See projectIntelliSense.ts for why this doesn't tear anything down on folder switch.
  useEffect(() => {
    loadProjectContext(rootFolder)
  }, [rootFolder])

  const refreshWorkspaceRef = useRef(refreshWorkspaceAfterTerminal)
  refreshWorkspaceRef.current = refreshWorkspaceAfterTerminal

  useEffect(() => {
    const off = window.api.fs.onChanged(() => {
      refreshWorkspaceRef.current()
    })
    return () => {
      off()
    }
  }, [])

  async function handleOpenFolder(): Promise<void> {
    const result = await window.api.fs.openFolder()
    if (!result) return
    setRootFolder(result.root)
    setRootEntries(result.entries)
    setGitRefreshToken((t) => t + 1)
    setSidebarView('explorer')
    setActivePath((current) => (current === WELCOME_TAB_ID ? null : current))
    refreshRecents()
  }

  function handleGoHome(): void {
    setShowWelcomeTab(true)
    setActivePath(WELCOME_TAB_ID)
  }

  async function handleOpenRecentFolder(folderPath: string): Promise<void> {
    const result = await window.api.fs.openFolderAtPath(folderPath)
    if (!result) {
      window.alert('That folder no longer exists. Removing it from Recent.')
      refreshRecents()
      return
    }
    setRootFolder(result.root)
    setRootEntries(result.entries)
    setGitRefreshToken((t) => t + 1)
    setSidebarView('explorer')
    setActivePath(null)
    refreshRecents()
  }

  async function handleRemoveRecentFolder(folderPath: string): Promise<void> {
    const updated = await window.api.settings.removeRecentFolder(folderPath)
    setRecentFolders(updated)
  }

  function parentDir(p: string): string {
    return p.replace(/[/\\][^/\\]*$/, '')
  }

  function basename(p: string): string {
    return p.split(/[/\\]/).pop() ?? p
  }

  function relFromRoot(p: string): string {
    if (!rootFolder) return p
    return p.startsWith(rootFolder) ? p.slice(rootFolder.length + 1) : p
  }

  function bumpTreeRefresh(): void {
    setTreeRefreshToken((t) => t + 1)
    if (rootFolder) window.api.fs.readDir(rootFolder).then(setRootEntries)
  }

  function renamePathInOpenState(oldPath: string, newPath: string): void {
    const newName = basename(newPath)
    setTabs((prev) =>
      prev.map((t) =>
        t.path === oldPath
          ? { ...t, path: newPath, name: newName, id: tabIdFor(newPath, t.diffMode) }
          : t
      )
    )
    setActivePath((current) => {
      if (current === tabIdFor(oldPath, false)) return tabIdFor(newPath, false)
      if (current === tabIdFor(oldPath, true)) return tabIdFor(newPath, true)
      return current
    })
  }

  function closeAndForgetPath(targetPath: string, isDirectory: boolean): void {
    setTabs((prev) =>
      prev.filter((t) => (isDirectory ? !t.path.startsWith(targetPath) : t.path !== targetPath))
    )
    setActivePath((current) => {
      if (!current) return current
      const matches = isDirectory
        ? current.startsWith(targetPath)
        : current === tabIdFor(targetPath, false) || current === tabIdFor(targetPath, true)
      return matches ? null : current
    })
  }

  function handleRevealInFinder(entry: FileEntry): void {
    window.api.fs.revealInFinder(entry.path)
  }

  function handleOpenTerminalHere(entry: FileEntry): void {
    const dir = entry.isDirectory ? entry.path : parentDir(entry.path)
    setBottomPanelVisible(true)
    setOpenTerminalAt(dir)
  }

  function handleCopyPath(entry: FileEntry): void {
    navigator.clipboard.writeText(entry.path).catch(() => {})
  }

  function handleCopyRelativePath(entry: FileEntry): void {
    navigator.clipboard.writeText(relFromRoot(entry.path)).catch(() => {})
  }

  function handleRenameEntry(entry: FileEntry): void {
    setInputModal({
      title: `Rename "${entry.name}"`,
      initialValue: entry.name,
      confirmLabel: 'Rename',
      onSubmit: async (newName) => {
        const newPath = `${parentDir(entry.path)}/${newName}`
        try {
          await window.api.fs.rename(entry.path, newPath)
          renamePathInOpenState(entry.path, newPath)
          bumpTreeRefresh()
          if (sidebarView === 'sourceControl') setGitRefreshToken((t) => t + 1)
        } catch (err) {
          window.alert(`Couldn't rename: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
  }

  async function handleDeleteEntry(entry: FileEntry): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${entry.name}"? This ${entry.isDirectory ? 'folder and everything inside it' : 'file'} cannot be recovered.`
    )
    if (!confirmed) return
    try {
      await window.api.fs.delete(entry.path, entry.isDirectory)
      closeAndForgetPath(entry.path, entry.isDirectory)
      bumpTreeRefresh()
      setGitRefreshToken((t) => t + 1)
    } catch (err) {
      window.alert(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function handleNewFileIn(dirEntry: FileEntry): void {
    setInputModal({
      title: 'New File',
      confirmLabel: 'Create',
      onSubmit: async (name) => {
        try {
          const created = await window.api.fs.createFile(dirEntry.path, name)
          bumpTreeRefresh()
          openFileByPath(created)
        } catch (err) {
          window.alert(`Couldn't create file: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
  }

  function handleNewFolderIn(dirEntry: FileEntry): void {
    setInputModal({
      title: 'New Folder',
      confirmLabel: 'Create',
      onSubmit: async (name) => {
        try {
          await window.api.fs.createFolder(dirEntry.path, name)
          bumpTreeRefresh()
        } catch (err) {
          window.alert(`Couldn't create folder: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
  }

  async function handleAddFileToChat(entry: FileEntry): Promise<void> {
    await openFileByPath(entry.path)
    setChatOpen(true)
    setChatIncludeSignal((c) => c + 1)
  }

  function handleCopyEntry(entry: FileEntry): void {
    setClipboardEntry({ path: entry.path, isDirectory: entry.isDirectory, mode: 'copy' })
  }

  function handleCutEntry(entry: FileEntry): void {
    setClipboardEntry({ path: entry.path, isDirectory: entry.isDirectory, mode: 'cut' })
  }

  async function handlePasteInto(dirEntry: FileEntry): Promise<void> {
    if (!clipboardEntry) return
    try {
      if (clipboardEntry.mode === 'copy') {
        await window.api.fs.copy(clipboardEntry.path, dirEntry.path)
      } else {
        const newPath = `${dirEntry.path}/${basename(clipboardEntry.path)}`
        await window.api.fs.rename(clipboardEntry.path, newPath)
        renamePathInOpenState(clipboardEntry.path, newPath)
        setClipboardEntry(null)
      }
      bumpTreeRefresh()
      setGitRefreshToken((t) => t + 1)
    } catch (err) {
      window.alert(`Couldn't paste: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function buildContextMenuItems(entry: FileEntry): ContextMenuEntry[] {
    if (entry.isDirectory) {
      return [
        { label: 'New File…', onClick: () => handleNewFileIn(entry) },
        { label: 'New Folder…', onClick: () => handleNewFolderIn(entry) },
        'separator',
        { label: 'Reveal in Finder', onClick: () => handleRevealInFinder(entry) },
        { label: 'Open in Integrated Terminal', onClick: () => handleOpenTerminalHere(entry) },
        'separator',
        { label: 'Cut', onClick: () => handleCutEntry(entry) },
        { label: 'Copy', onClick: () => handleCopyEntry(entry) },
        { label: 'Paste', onClick: () => handlePasteInto(entry), disabled: !clipboardEntry },
        'separator',
        { label: 'Copy Path', onClick: () => handleCopyPath(entry) },
        { label: 'Copy Relative Path', onClick: () => handleCopyRelativePath(entry) },
        'separator',
        { label: 'Rename…', onClick: () => handleRenameEntry(entry) },
        { label: 'Delete', onClick: () => handleDeleteEntry(entry), danger: true }
      ]
    }
    return [
      { label: 'Open', onClick: () => openFileByPath(entry.path) },
      'separator',
      { label: 'Add File to Chat', onClick: () => handleAddFileToChat(entry) },
      'separator',
      { label: 'Reveal in Finder', onClick: () => handleRevealInFinder(entry) },
      { label: 'Open in Integrated Terminal', onClick: () => handleOpenTerminalHere(entry) },
      'separator',
      { label: 'Cut', onClick: () => handleCutEntry(entry) },
      { label: 'Copy', onClick: () => handleCopyEntry(entry) },
      'separator',
      { label: 'Copy Path', onClick: () => handleCopyPath(entry) },
      { label: 'Copy Relative Path', onClick: () => handleCopyRelativePath(entry) },
      'separator',
      { label: 'Rename…', onClick: () => handleRenameEntry(entry) },
      { label: 'Delete', onClick: () => handleDeleteEntry(entry), danger: true }
    ]
  }

  // Falls back to a suffix/basename match when an AI-cited path doesn't exist verbatim (e.g. missing project-root prefix).
  async function resolveMissingPath(citedPath: string): Promise<string | null> {
    if (!rootFolder) return null
    const files = await window.api.search.listFiles(rootFolder)
    const normalized = citedPath.replace(/^\/+/, '')
    const suffixMatch = files.find((f) => f === citedPath || f.endsWith(`/${normalized}`))
    if (suffixMatch) return suffixMatch
    const baseName = normalized.split(/[/\\]/).pop()
    const baseMatch = baseName ? files.find((f) => f.split(/[/\\]/).pop() === baseName) : undefined
    return baseMatch ?? null
  }

  // `diffMode` picks which of the (up to) two coexisting tabs for this path to open/focus: the
  // plain tab (id === path) or the "Working Tree" diff tab (id === `${path}::workingtree`).
  // Opening via a plain route (Explorer, search, breadcrumbs) always targets the plain one;
  // opening via Source Control's "Changes" row always targets the working-tree one.
  async function openFileByPath(filePath: string, line?: number, diffMode = false): Promise<void> {
    const id = tabIdFor(filePath, diffMode)
    const existing = tabs.find((t) => t.id === id)
    if (existing) {
      setActivePath(id)
      if (line) setRevealTarget({ path: filePath, line })
      return
    }

    let resolvedPath = filePath
    let content: string
    try {
      content = await window.api.fs.readFile(filePath)
    } catch {
      const fallback = await resolveMissingPath(filePath)
      if (!fallback) {
        window.alert(`Couldn't open "${filePath}" — no matching file found in this project.`)
        return
      }
      const fallbackId = tabIdFor(fallback, diffMode)
      const existingFallback = tabs.find((t) => t.id === fallbackId)
      if (existingFallback) {
        setActivePath(fallbackId)
        if (line) setRevealTarget({ path: fallback, line })
        return
      }
      try {
        content = await window.api.fs.readFile(fallback)
      } catch {
        window.alert(`Couldn't open "${filePath}" — no matching file found in this project.`)
        return
      }
      resolvedPath = fallback
    }

    const name = resolvedPath.split(/[/\\]/).pop() ?? resolvedPath
    const tab: OpenTab = {
      id: tabIdFor(resolvedPath, diffMode),
      path: resolvedPath,
      name,
      content,
      savedContent: content,
      isDirty: false,
      isUntitled: false,
      diffMode
    }
    setTabs((prev) => [...prev, tab])
    setActivePath(tab.id)
    if (line) {
      setRevealTarget({ path: resolvedPath, line })
    }
  }

  function reloadTabIfOpen(filePath: string): void {
    if (!tabs.some((t) => t.path === filePath)) {
      setTreeRefreshToken((t) => t + 1)
      setGitRefreshToken((t) => t + 1)
      return
    }
    window.api.fs
      .readFile(filePath)
      .then((content) => {
        setTabs((prev) =>
          prev.map((t) => (t.path === filePath ? { ...t, content, savedContent: content, isDirty: false } : t))
        )
      })
      .catch(() => {})
    setTreeRefreshToken((t) => t + 1)
    setGitRefreshToken((t) => t + 1)
  }

  function closeTabIfOpen(filePath: string): void {
    setTabs((prev) => prev.filter((t) => t.path !== filePath))
    setActivePath((prev) =>
      prev === tabIdFor(filePath, false) || prev === tabIdFor(filePath, true) ? null : prev
    )
    setTreeRefreshToken((t) => t + 1)
    setGitRefreshToken((t) => t + 1)
  }

  // A terminal command run by the AI can touch any number of files without telling us which —
  // unlike write_file, there's no single path to reload, so refresh the whole workspace: the file
  // tree, git status, and any open-but-unedited tab that might now be showing stale content.
  function refreshWorkspaceAfterTerminal(): void {
    tabs
      .filter((t) => !t.isDirty && !t.isUntitled)
      .forEach((t) => {
        window.api.fs
          .readFile(t.path)
          .then((content) => {
            setTabs((cur) =>
              cur.map((c) => (c.path === t.path && !c.isDirty ? { ...c, content, savedContent: content } : c))
            )
          })
          .catch(() => {})
      })
    setTreeRefreshToken((t) => t + 1)
    setGitRefreshToken((t) => t + 1)
  }

  async function handleOpenFile(entry: FileEntry): Promise<void> {
    await openFileByPath(entry.path)
  }

  function handleNewFile(): void {
    untitledCounter += 1
    const path = `untitled:${untitledCounter}`
    const tab: OpenTab = {
      id: path,
      path,
      name: `Untitled-${untitledCounter}`,
      content: '',
      savedContent: '',
      isDirty: false,
      isUntitled: true
    }
    setTabs((prev) => [...prev, tab])
    setActivePath(path)
  }

  function handleChange(id: string, content: string): void {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content, isDirty: content !== t.savedContent } : t))
    )
  }

  // `explicitContent` lets a caller that just formatted the buffer (see EditorArea's
  // format-on-save) pass the freshly-formatted text directly, instead of relying on React state
  // that may not have caught up to the format edit yet by the time this runs.
  async function handleSave(id: string, forceSaveAs = false, explicitContent?: string): Promise<void> {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const content = explicitContent ?? tab.content

    if (tab.isUntitled || forceSaveAs) {
      const target = await window.api.fs.showSaveDialog(tab.isUntitled ? tab.name : tab.path)
      if (!target) return
      await window.api.fs.writeFile(target, content)
      const name = target.split(/[/\\]/).pop() ?? target
      const newId = tabIdFor(target, tab.diffMode)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, id: newId, path: target, name, content, savedContent: content, isDirty: false, isUntitled: false }
            : t
        )
      )
      if (activePath === id) setActivePath(newId)
    } else {
      await window.api.fs.writeFile(tab.path, content)
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, content, savedContent: content, isDirty: false } : t))
      )
    }
    setGitRefreshToken((t) => t + 1)
  }

  function handleCloseTab(id: string): void {
    if (id === WELCOME_TAB_ID) {
      setShowWelcomeTab(false)
      if (activePath === WELCOME_TAB_ID) {
        setActivePath(tabs.length > 0 ? tabs[tabs.length - 1].id : null)
      }
      return
    }
    const tab = tabs.find((t) => t.id === id)
    if (tab?.isDirty) {
      const confirmed = window.confirm(`"${tab.name}" has unsaved changes. Close anyway?`)
      if (!confirmed) return
    }
    setTabs((prev) => prev.filter((t) => t.id !== id))
    if (activePath === id) {
      const remaining = tabs.filter((t) => t.id !== id)
      setActivePath(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  function handleReorderTabs(fromIndex: number, toIndex: number): void {
    setTabs((prev) => {
      const copy = [...prev]
      const [moved] = copy.splice(fromIndex, 1)
      copy.splice(toIndex, 0, moved)
      return copy
    })
  }

  // Diff tabs (Source Control "Working Tree" / "Index" views) are a separate list from real file
  // tabs so a file already open for editing and its git diff can coexist as distinct tabs.
  function openDiffTab(gitRoot: string, relPath: string): void {
    const id = `${gitRoot}/${relPath}::index`
    setDiffTabs((prev) =>
      prev.some((d) => d.id === id)
        ? prev
        : [...prev, { id, gitRoot, relPath, name: relPath.split(/[/\\]/).pop() ?? relPath }]
    )
    setActivePath(id)
  }

  function handleCloseDiffTab(id: string): void {
    setDiffTabs((prev) => prev.filter((d) => d.id !== id))
    if (activePath === id) {
      const remaining = diffTabs.filter((d) => d.id !== id)
      setActivePath(
        remaining.length > 0
          ? remaining[remaining.length - 1].id
          : tabs.length > 0
            ? tabs[tabs.length - 1].path
            : null
      )
    }
  }

  function handleSelectSidebar(view: SidebarView): void {
    setSidebarView((current) => (current === view ? null : view))
  }

  function handleRunAction(action: string): void {
    switch (action) {
      case 'open-settings':
        setSidebarView('settings')
        break
      case 'new-file':
        handleNewFile()
        break
      case 'open-folder':
        handleOpenFolder()
        break
      case 'save-file':
        if (activePath) handleSave(activePath)
        break
      case 'save-file-as':
        if (activePath) handleSave(activePath, true)
        break
      case 'close-tab':
        if (activePath) handleCloseTab(activePath)
        break
      case 'format-document':
        setEditorActionSignal({ type: 'format', token: Date.now() })
        break
      case 'goto-definition':
        setEditorActionSignal({ type: 'goto-definition', token: Date.now() })
        break
      case 'find-references':
        setEditorActionSignal({ type: 'find-references', token: Date.now() })
        break
      case 'ai-edit-selection':
        setEditorActionSignal({ type: 'inline-edit', token: Date.now() })
        break
      case 'open-search':
        setSidebarView('search')
        break
      case 'open-command-palette':
        setCommandPaletteVisible(true)
        break
      case 'open-quick-open':
        if (rootFolder) setQuickOpenVisible(true)
        break
      case 'view-explorer':
        setSidebarView('explorer')
        break
      case 'view-source-control':
        setSidebarView('sourceControl')
        break
      case 'view-run':
        setSidebarView('run')
        break
      case 'view-extensions':
        setSidebarView('extensions')
        break
      case 'toggle-sidebar':
        setSidebarView((v) => (v ? null : 'explorer'))
        break
      case 'toggle-panel':
        setBottomPanelVisible((v) => !v)
        break
      case 'toggle-chat':
        setChatOpen((v) => !v)
        break
      case 'new-terminal':
      case 'split-terminal':
        setBottomPanelVisible(true)
        setNewTerminalSignal((c) => c + 1)
        break
      case 'about':
        window.alert('LLMRaki 0.1.0\nA desktop code editor with a built-in AI assistant.')
        break
      case 'show-welcome':
        setShowWelcomeTab(true)
        setActivePath(WELCOME_TAB_ID)
        break
      default:
        break
    }
  }

  useEffect(() => {
    const off = window.api.menu.onAction(handleRunAction)
    return () => {
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activePath, rootFolder, sidebarView])

  const gitChangeCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  return (
    <>
      <div className={`app-splash ${booting ? '' : 'app-splash-hidden'}`}>
        <img src={appLogo} alt="LLMRaki" className="app-splash-logo" />
      </div>
      <div className="app-shell">
      <div className="app-titlebar">
        <div className="titlebar-side left">{rootFolder ? rootFolder.split(/[/\\]/).pop() : 'LLMRaki'}</div>
        <TopSearchBar
          rootFolder={rootFolder}
          onOpenFile={(filePath) => {
            setSidebarView('explorer')
            openFileByPath(filePath)
          }}
        />
        <div className="titlebar-side right" />
      </div>
      <div className="app-body">
        <ActivityBar
          sidebarView={sidebarView}
          chatOpen={chatOpen}
          gitBadge={gitChangeCount}
          onSelectSidebar={handleSelectSidebar}
          onToggleChat={() => setChatOpen((v) => !v)}
          onGoHome={handleGoHome}
        />

        {sidebarView === 'explorer' && (
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <FileExplorer
              root={rootFolder}
              entries={rootEntries}
              selectedPath={activePath}
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              onContextMenu={(entry, x, y) => setContextMenu({ entry, x, y })}
              refreshToken={treeRefreshToken}
            />
          </div>
        )}

        {sidebarView === 'search' && (
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <SearchPanel rootFolder={rootFolder} onOpenMatch={(file, line) => openFileByPath(file, line)} />
          </div>
        )}

        {sidebarView === 'sourceControl' && (
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <SourceControlPanel
              rootFolder={rootFolder}
              onOpenFile={(p, diffMode) => openFileByPath(p, undefined, diffMode)}
              onOpenDiffTab={openDiffTab}
              onStatusChange={setGitStatus}
              refreshToken={gitRefreshToken}
            />
          </div>
        )}

        {sidebarView === 'run' && (
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <RunPanel
              activeFileName={activeTab?.name ?? null}
              activeFilePath={activeTab?.path ?? null}
              onRun={(command) => {
                setBottomPanelVisible(true)
                setRunCommand(command)
              }}
              debugState={debuggerSession.state}
              breakpoints={debuggerSession.breakpoints}
              onStartDebugging={(path) => {
                setBottomPanelVisible(true)
                setBottomPanelTab('debug')
                debuggerSession.start(path)
              }}
              onStop={debuggerSession.stop}
              onContinue={debuggerSession.continue_}
              onStepOver={debuggerSession.stepOver}
              onStepInto={debuggerSession.stepInto}
              onStepOut={debuggerSession.stepOut}
              onSelectFrame={debuggerSession.setActiveFrameIndex}
              onOpenFile={(filePath, line) => openFileByPath(filePath, line)}
              onToggleBreakpoint={debuggerSession.toggleBreakpoint}
              getVariables={debuggerSession.getProperties}
            />
          </div>
        )}

        {sidebarView === 'extensions' && (
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <ExtensionsPanel />
          </div>
        )}

        {sidebarView === 'settings' && (
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <SettingsPanel />
          </div>
        )}

        {sidebarView && <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeStart} />}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <EditorArea
              tabs={tabs}
              diffTabs={diffTabs}
              activePath={activePath}
              rootFolder={rootFolder}
              revealLine={revealTarget?.path === activePath ? revealTarget.line : null}
              showWelcomeTab={showWelcomeTab}
              onSelectTab={setActivePath}
              onCloseTab={handleCloseTab}
              onReorderTabs={handleReorderTabs}
              onCloseDiffTab={handleCloseDiffTab}
              onChange={handleChange}
              onSave={handleSave}
              onCursorChange={(line, column) => setCursor({ line, column })}
              onRevealed={() => setRevealTarget(null)}
              onOpenFile={(filePath) => openFileByPath(filePath)}
              editorActionSignal={editorActionSignal}
              breakpoints={debuggerSession.breakpoints}
              onToggleBreakpoint={debuggerSession.toggleBreakpoint}
              pausedLocation={debuggerSession.pausedLocation}
              welcomeProps={{
                recentFolders,
                onNewFile: handleNewFile,
                onOpenFolder: handleOpenFolder,
                onOpenRecent: handleOpenRecentFolder,
                onRemoveRecent: handleRemoveRecentFolder
              }}
            />
            {chatOpen && (
              <>
                <div className="chat-resize-handle" onMouseDown={handleChatResizeStart} />
                <ChatPanel
                  width={chatPanelWidth}
                  rootFolder={rootFolder}
                  activeFileName={activeTab?.name ?? null}
                  activeFileContent={activeTab?.content ?? null}
                  onOpenFile={(filePath, line) => openFileByPath(filePath, line)}
                  onOpenSettings={() => setSidebarView('settings')}
                  forceIncludeSignal={chatIncludeSignal}
                  onFileChanged={reloadTabIfOpen}
                  onFileRemoved={closeTabIfOpen}
                  onWorkspaceChanged={refreshWorkspaceAfterTerminal}
                />
              </>
            )}
          </div>
          {bottomPanelVisible && (
            <div
              style={{
                height: panelMaximized ? '75vh' : 260,
                borderTop: '1px solid var(--border)',
                flexShrink: 0
              }}
            >
              <BottomPanel
                visible={bottomPanelVisible}
                activeTab={bottomPanelTab}
                onTabChange={setBottomPanelTab}
                rootFolder={rootFolder}
                newTerminalSignal={newTerminalSignal}
                openTerminalAt={openTerminalAt}
                onOpenTerminalAtConsumed={() => setOpenTerminalAt(null)}
                runCommand={runCommand}
                onRunConsumed={() => setRunCommand(null)}
                debugOutput={debuggerSession.state.output}
                debugPaused={debuggerSession.state.status === 'paused'}
                onDebugEvaluate={debuggerSession.evaluate}
                maximized={panelMaximized}
                onToggleMaximize={() => setPanelMaximized((v) => !v)}
                onClose={() => {
                  setBottomPanelVisible(false)
                  setPanelMaximized(false)
                }}
              />
            </div>
          )}
        </div>
      </div>
      <StatusBar
        rootFolder={rootFolder}
        activeFileName={activeTab?.name ?? null}
        language={activeTab ? languageForFile(activeTab.name) : null}
        cursor={activeTab ? cursor : null}
        gitStatus={gitStatus}
        onOpenSourceControl={() => setSidebarView('sourceControl')}
        onOpenProblems={() => {
          setBottomPanelVisible(true)
          setBottomPanelTab('problems')
        }}
      />

      {quickOpenVisible && rootFolder && (
        <QuickOpen
          rootFolder={rootFolder}
          onSelect={(filePath) => {
            openFileByPath(filePath)
            setQuickOpenVisible(false)
          }}
          onClose={() => setQuickOpenVisible(false)}
        />
      )}

      {commandPaletteVisible && (
        <CommandPalette
          commands={COMMANDS}
          onRun={(id) => {
            setCommandPaletteVisible(false)
            handleRunAction(id)
          }}
          onClose={() => setCommandPaletteVisible(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.entry)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {inputModal && (
        <InputModal
          title={inputModal.title}
          initialValue={inputModal.initialValue}
          confirmLabel={inputModal.confirmLabel}
          onSubmit={inputModal.onSubmit}
          onClose={() => setInputModal(null)}
        />
      )}
      </div>
    </>
  )
}
