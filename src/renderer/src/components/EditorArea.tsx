import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { BlameLine, OpenTab, RecentFolder, WELCOME_TAB_ID } from '../types'
import { languageForFile } from '../utils/language'
import { CloseIcon } from './Icons'
import FileTypeBadge from './FileTypeBadge'
import WelcomeView from './WelcomeView'
import Breadcrumbs, { SymbolCrumb } from './Breadcrumbs'

const SYMBOL_LANGUAGES = new Set(['typescript', 'javascript'])

function blameLabel(b: BlameLine): string {
  if (/^0+$/.test(b.hash)) return 'Uncommitted changes'
  const diffMs = Date.now() - b.authorTime * 1000
  const mins = Math.floor(diffMs / 60000)
  let when: string
  if (mins < 1) when = 'just now'
  else if (mins < 60) when = `${mins}m ago`
  else if (mins < 1440) when = `${Math.floor(mins / 60)}h ago`
  else when = `${Math.floor(mins / 1440)}d ago`
  return `${b.author}, ${when} • ${b.summary}`
}

interface Props {
  tabs: OpenTab[]
  activePath: string | null
  rootFolder: string | null
  revealLine: number | null
  showWelcomeTab: boolean
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChange: (path: string, content: string) => void
  onSave: (path: string) => void
  onCursorChange: (line: number, column: number) => void
  onRevealed: () => void
  onOpenFile: (path: string) => void
  welcomeProps: {
    recentFolders: RecentFolder[]
    onNewFile: () => void
    onOpenFolder: () => void
    onOpenRecent: (path: string) => void
    onRemoveRecent: (path: string) => void
  }
}

export default function EditorArea({
  tabs,
  activePath,
  rootFolder,
  revealLine,
  showWelcomeTab,
  onSelectTab,
  onCloseTab,
  onChange,
  onSave,
  onCursorChange,
  onRevealed,
  onOpenFile,
  welcomeProps
}: Props): JSX.Element {
  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const showingWelcome = activePath === WELCOME_TAB_ID
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const blameRef = useRef<BlameLine[]>([])
  const blameDecorationIds = useRef<string[]>([])
  const gitRootRef = useRef<string | null>(null)
  const symbolDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [symbolPath, setSymbolPath] = useState<SymbolCrumb[]>([])

  function revealLineNow(editorInstance: editor.IStandaloneCodeEditor, line: number): void {
    editorInstance.revealLineInCenter(line)
    editorInstance.setPosition({ lineNumber: line, column: 1 })
    editorInstance.focus()
  }

  // Handles the file-already-open case; a fresh mount is handled separately in onMount since editorRef may still point at a just-unmounted editor.
  useEffect(() => {
    if (revealLine !== null && editorRef.current) {
      revealLineNow(editorRef.current, revealLine)
      onRevealed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealLine, activeTab?.path])

  useEffect(() => {
    if (!rootFolder) {
      gitRootRef.current = null
      return
    }
    let cancelled = false
    window.api.git.findRoot(rootFolder).then((found) => {
      if (!cancelled) gitRootRef.current = found
    })
    return () => {
      cancelled = true
    }
  }, [rootFolder])

  function updateBlameDecoration(lineNumber: number): void {
    const editorInstance = editorRef.current
    const monaco = monacoRef.current
    if (!editorInstance || !monaco) return
    const model = editorInstance.getModel()
    if (!model) return
    const blameLine = blameRef.current.find((b) => b.line === lineNumber)
    if (!blameLine) {
      blameDecorationIds.current = editorInstance.deltaDecorations(blameDecorationIds.current, [])
      return
    }
    const endColumn = model.getLineMaxColumn(lineNumber)
    blameDecorationIds.current = editorInstance.deltaDecorations(blameDecorationIds.current, [
      {
        range: new monaco.Range(lineNumber, endColumn, lineNumber, endColumn),
        options: {
          after: {
            content: '   ' + blameLabel(blameLine),
            inlineClassName: 'blame-inline-decoration',
            cursorStops: monaco.editor.InjectedTextCursorStops.None
          }
        }
      }
    ])
  }

  // Whole-file blame is fetched once per file (not per-line) — cheap, and refreshed whenever
  // the file changes on disk (open, or after a save via the git-status refresh cycle upstream).
  useEffect(() => {
    blameRef.current = []
    blameDecorationIds.current = []
    if (symbolDebounceRef.current) clearTimeout(symbolDebounceRef.current)
    if (!activeTab || !rootFolder) return
    let cancelled = false
    ;(async () => {
      const gitRoot = gitRootRef.current ?? (await window.api.git.findRoot(rootFolder))
      gitRootRef.current = gitRoot
      if (!gitRoot || cancelled) return
      const lines = await window.api.git.blameFile(gitRoot, activeTab.path)
      if (cancelled) return
      blameRef.current = lines
      const pos = editorRef.current?.getPosition()
      if (pos) updateBlameDecoration(pos.lineNumber)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.path, rootFolder])

  async function computeSymbolPath(lineNumber: number, column: number): Promise<void> {
    const monaco = monacoRef.current
    const editorInstance = editorRef.current
    if (!monaco || !editorInstance) return
    const model = editorInstance.getModel()
    if (!model) return
    const lang = model.getLanguageId()
    if (!SYMBOL_LANGUAGES.has(lang)) {
      setSymbolPath([])
      return
    }
    const offset = model.getOffsetAt({ lineNumber, column })
    try {
      const workerGetter =
        lang === 'typescript'
          ? await monaco.languages.typescript.getTypeScriptWorker()
          : await monaco.languages.typescript.getJavaScriptWorker()
      const client = await workerGetter(model.uri)
      const tree = await client.getNavigationTree(model.uri.toString())
      const path: SymbolCrumb[] = []
      let items: {
        text: string
        spans: { start: number; length: number }[]
        childItems?: unknown[]
      }[] = (tree?.childItems as typeof items) ?? []
      while (items && items.length > 0) {
        const match = items.find((it) =>
          it.spans?.some((s) => offset >= s.start && offset <= s.start + s.length)
        )
        if (!match) break
        path.push({ name: match.text || '(anonymous)', offset: match.spans[0].start })
        items = (match.childItems as typeof items) ?? []
      }
      setSymbolPath(path)
    } catch {
      setSymbolPath([])
    }
  }

  function jumpToOffset(offset: number): void {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    if (!editorInstance || !model) return
    const pos = model.getPositionAt(offset)
    editorInstance.revealPositionInCenter(pos)
    editorInstance.setPosition(pos)
    editorInstance.focus()
  }

  return (
    <div className="editor-area">
      {(tabs.length > 0 || showWelcomeTab) && (
        <div className="editor-tabs">
          {showWelcomeTab && (
            <div
              className={`editor-tab ${showingWelcome ? 'active' : ''}`}
              onClick={() => onSelectTab(WELCOME_TAB_ID)}
            >
              <span>Welcome</span>
              <button
                className="close-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(WELCOME_TAB_ID)
                }}
              >
                <CloseIcon />
              </button>
            </div>
          )}
          {tabs.map((tab) => (
            <div
              key={tab.path}
              className={`editor-tab ${tab.path === activePath ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.path)}
            >
              <FileTypeBadge fileName={tab.name} />
              <span>{tab.name}</span>
              {tab.isDirty && <span className="dirty-dot" />}
              <button
                className="close-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.path)
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {showingWelcome && <WelcomeView {...welcomeProps} />}

      {!showingWelcome && !activeTab && (
        <div className="editor-empty">
          <div style={{ fontSize: 15 }}>LLMRaki</div>
          <div style={{ fontSize: 12 }}>Open a file from the Explorer to start editing</div>
        </div>
      )}

      {!showingWelcome && activeTab && rootFolder && (
        <Breadcrumbs
          rootFolder={rootFolder}
          filePath={activeTab.path}
          symbolPath={symbolPath}
          onOpenFile={onOpenFile}
          onJumpToOffset={jumpToOffset}
        />
      )}

      {!showingWelcome && activeTab && (
        <Editor
          key={activeTab.path}
          language={languageForFile(activeTab.name)}
          value={activeTab.content}
          theme="llmraki-dark"
          onChange={(value) => onChange(activeTab.path, value ?? '')}
          onMount={(editorInstance, monaco) => {
            editorRef.current = editorInstance
            monacoRef.current = monaco
            editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
              onSave(activeTab.path)
            )
            editorInstance.onDidChangeCursorPosition((e) => {
              onCursorChange(e.position.lineNumber, e.position.column)
              updateBlameDecoration(e.position.lineNumber)
              computeSymbolPath(e.position.lineNumber, e.position.column)
            })
            editorInstance.onDidChangeModelContent(() => {
              if (symbolDebounceRef.current) clearTimeout(symbolDebounceRef.current)
              symbolDebounceRef.current = setTimeout(() => {
                const pos = editorInstance.getPosition()
                if (pos) computeSymbolPath(pos.lineNumber, pos.column)
              }, 400)
            })
            if (revealLine !== null) {
              revealLineNow(editorInstance, revealLine)
              onRevealed()
            }
            const initialPos = editorInstance.getPosition()
            if (initialPos) {
              updateBlameDecoration(initialPos.lineNumber)
              computeSymbolPath(initialPos.lineNumber, initialPos.column)
            }
          }}
          options={{
            fontSize: 13,
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false
          }}
        />
      )}
    </div>
  )
}
