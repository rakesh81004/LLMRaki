import { useEffect, useRef, useState } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { BlameLine, DiffTab, OpenTab, RecentFolder, WELCOME_TAB_ID } from '../types'
import { languageForFile } from '../utils/language'
import { CloseIcon, LockIcon } from './Icons'
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

function relPathFrom(gitRoot: string, absPath: string): string {
  const normRoot = gitRoot.replace(/\\/g, '/')
  const normPath = absPath.replace(/\\/g, '/')
  return normPath.startsWith(normRoot + '/') ? normPath.slice(normRoot.length + 1) : normPath
}

interface Props {
  tabs: OpenTab[]
  diffTabs: DiffTab[]
  activePath: string | null
  rootFolder: string | null
  revealLine: number | null
  showWelcomeTab: boolean
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onCloseDiffTab: (id: string) => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
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
  diffTabs,
  activePath,
  rootFolder,
  revealLine,
  showWelcomeTab,
  onSelectTab,
  onCloseTab,
  onCloseDiffTab,
  onReorderTabs,
  onChange,
  onSave,
  onCursorChange,
  onRevealed,
  onOpenFile,
  welcomeProps
}: Props): JSX.Element {
  const activeTab = tabs.find((t) => t.id === activePath) ?? null
  const activeDiffTab = diffTabs.find((d) => d.id === activePath) ?? null
  const [indexTabData, setIndexTabData] = useState<Record<string, { content: string; baseline: string }>>(
    {}
  )
  const showingWelcome = activePath === WELCOME_TAB_ID
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const blameRef = useRef<BlameLine[]>([])
  const blameDecorationIds = useRef<string[]>([])
  const gitRootRef = useRef<string | null>(null)
  const symbolDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [symbolPath, setSymbolPath] = useState<SymbolCrumb[]>([])
  const [gitAvailable, setGitAvailable] = useState(false)
  // Cached per file path (not re-fetched, and not reset to '' on every visit) — otherwise
  // switching away from a "Working Tree" tab and back briefly re-diffs against an empty
  // baseline before the fetch resolves, flashing the whole file green before correcting itself.
  const [workingBaselineCache, setWorkingBaselineCache] = useState<Record<string, string>>({})
  const [dragTabIndex, setDragTabIndex] = useState<number | null>(null)
  // `onMount` only fires once per editor instance, so a callback registered inside it
  // (Cmd+S, content-change) would otherwise close over whichever `onSave`/`onChange` prop
  // existed at that first render — stale forever after, since App re-creates those functions
  // on every render. Route through a ref that's refreshed every render instead, so the
  // save command always calls the version that reads the *current* tab content.
  const latestCallbacksRef = useRef({ onSave, onChange })
  latestCallbacksRef.current = { onSave, onChange }
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map())

  function registerTabNode(key: string, node: HTMLDivElement | null): void {
    if (node) tabNodesRef.current.set(key, node)
    else tabNodesRef.current.delete(key)
  }

  // The tab strip scrolls horizontally once it overflows — bring the newly active tab into
  // view instead of leaving it hidden off to the side.
  useEffect(() => {
    if (!activePath) return
    const node = tabNodesRef.current.get(activePath)
    node?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activePath])

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

  // Staged content is a fixed snapshot (the read-only "Index" tab), fetched once per tab id —
  // both the staged blob itself and the HEAD version it's diffed against.
  useEffect(() => {
    if (!activeDiffTab || indexTabData[activeDiffTab.id] !== undefined) return
    let cancelled = false
    ;(async () => {
      const [staged, head] = await Promise.all([
        window.api.git.showFileAtRef(activeDiffTab.gitRoot, `:${activeDiffTab.relPath}`),
        window.api.git.showFileAtRef(activeDiffTab.gitRoot, `HEAD:${activeDiffTab.relPath}`)
      ])
      if (cancelled) return
      setIndexTabData((prev) => ({
        ...prev,
        [activeDiffTab.id]: { content: staged ?? '', baseline: head ?? '' }
      }))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiffTab?.id])

  useEffect(() => {
    // Reset synchronously as soon as `rootFolder` changes (not just once the async resolution
    // below finishes) — otherwise a project switch leaves gitRootRef pointing at the *previous*
    // project's git root for that brief window, and other effects that opportunistically reuse
    // it (blame, diff baseline) via `gitRootRef.current ?? ...` would silently run git commands
    // against the wrong repo instead of falling back to resolving it themselves.
    gitRootRef.current = null
    setGitAvailable(false)
    if (!rootFolder) return
    let cancelled = false
    window.api.git.findRoot(rootFolder).then((found) => {
      if (cancelled) return
      gitRootRef.current = found
      setGitAvailable(!!found)
    })
    return () => {
      cancelled = true
    }
  }, [rootFolder])

  // The live-editable file's diff baseline is the index (git's own default "unstaged changes"
  // comparison) — Monaco's own DiffEditor renders the inline red/green diff against this,
  // recomputing itself as the modified side is typed into, so no manual decoration bookkeeping.
  useEffect(() => {
    if (!activeTab || !activeTab.diffMode || !gitAvailable) return
    if (workingBaselineCache[activeTab.path] !== undefined) return
    const gitRoot = gitRootRef.current
    if (!gitRoot) return
    let cancelled = false
    ;(async () => {
      const rel = relPathFrom(gitRoot, activeTab.path)
      const indexContent = await window.api.git.showFileAtRef(gitRoot, `:${rel}`)
      if (!cancelled) {
        setWorkingBaselineCache((prev) => ({ ...prev, [activeTab.path]: indexContent ?? '' }))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, gitAvailable])

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
          // The range is a zero-width point at end-of-line, i.e. always "collapsed" — Monaco
          // silently skips rendering a decoration whose range is collapsed unless told not to.
          showIfCollapsed: true,
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

  function wireModifiedEditor(
    tabId: string,
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ): void {
    editorRef.current = editorInstance
    monacoRef.current = monaco
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      latestCallbacksRef.current.onSave(tabId)
    )
    editorInstance.onDidChangeCursorPosition((e) => {
      onCursorChange(e.position.lineNumber, e.position.column)
      updateBlameDecoration(e.position.lineNumber)
      computeSymbolPath(e.position.lineNumber, e.position.column)
    })
    editorInstance.onDidChangeModelContent(() => {
      latestCallbacksRef.current.onChange(tabId, editorInstance.getValue())
      if (symbolDebounceRef.current) clearTimeout(symbolDebounceRef.current)
      symbolDebounceRef.current = setTimeout(() => {
        const pos = editorInstance.getPosition()
        if (pos) computeSymbolPath(pos.lineNumber, pos.column)
      }, 400)
    })
    // A decoration applied before Monaco's first real layout pass (e.g. right at mount, while
    // automaticLayout is still catching up to the container's true size) can silently fail to
    // paint even once the editor resizes — re-apply once layout actually settles.
    editorInstance.onDidLayoutChange(() => {
      const pos = editorInstance.getPosition()
      if (pos) updateBlameDecoration(pos.lineNumber)
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
  }

  return (
    <div className="editor-area">
      {(tabs.length > 0 || diffTabs.length > 0 || showWelcomeTab) && (
        <div className="editor-tabs">
          {showWelcomeTab && (
            <div
              ref={(node) => registerTabNode(WELCOME_TAB_ID, node)}
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
          {tabs.map((tab, idx) => (
            <div
              key={tab.id}
              ref={(node) => registerTabNode(tab.id, node)}
              draggable
              className={`editor-tab ${tab.id === activePath ? 'active' : ''} ${
                dragTabIndex === idx ? 'dragging' : ''
              }`}
              onClick={() => onSelectTab(tab.id)}
              onDragStart={() => setDragTabIndex(idx)}
              onDragEnd={() => setDragTabIndex(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragTabIndex !== null && dragTabIndex !== idx) onReorderTabs(dragTabIndex, idx)
                setDragTabIndex(null)
              }}
            >
              <FileTypeBadge fileName={tab.name} />
              <span>{tab.name}</span>
              {tab.diffMode && <span className="diff-tab-suffix">Working Tree</span>}
              {tab.isDirty && <span className="dirty-dot" />}
              <button
                className="close-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          {diffTabs.map((d) => (
            <div
              key={d.id}
              ref={(node) => registerTabNode(d.id, node)}
              className={`editor-tab diff-tab ${d.id === activePath ? 'active' : ''}`}
              onClick={() => onSelectTab(d.id)}
            >
              <FileTypeBadge fileName={d.name} />
              <span>{d.name}</span>
              <span className="diff-tab-suffix">Index</span>
              <span className="diff-tab-lock" title="Read-only: staged content">
                <LockIcon />
              </span>
              <button
                className="close-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseDiffTab(d.id)
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {showingWelcome && <WelcomeView {...welcomeProps} />}

      {!showingWelcome && activeDiffTab && indexTabData[activeDiffTab.id] === undefined && (
        <div className="editor-empty">
          <div style={{ fontSize: 13 }}>Loading staged content…</div>
        </div>
      )}

      {!showingWelcome && activeDiffTab && indexTabData[activeDiffTab.id] !== undefined && (
        <DiffEditor
          key={activeDiffTab.id}
          language={languageForFile(activeDiffTab.name)}
          original={indexTabData[activeDiffTab.id].baseline}
          modified={indexTabData[activeDiffTab.id].content}
          originalModelPath={`diff-head://${activeDiffTab.gitRoot}/${activeDiffTab.relPath}`}
          modifiedModelPath={`diff-staged://${activeDiffTab.gitRoot}/${activeDiffTab.relPath}`}
          theme="llmraki-dark"
          onMount={(diffEditorInstance, monaco) => {
            editorRef.current = diffEditorInstance.getModifiedEditor()
            monacoRef.current = monaco
          }}
          options={{
            fontSize: 13,
            renderSideBySide: false,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            readOnly: true
          }}
        />
      )}

      {!showingWelcome && !activeTab && !activeDiffTab && (
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

      {!showingWelcome &&
        activeTab &&
        activeTab.diffMode &&
        gitAvailable &&
        workingBaselineCache[activeTab.path] === undefined && (
          <div className="editor-empty">
            <div style={{ fontSize: 13 }}>Loading diff…</div>
          </div>
        )}

      {!showingWelcome &&
        activeTab &&
        activeTab.diffMode &&
        gitAvailable &&
        workingBaselineCache[activeTab.path] !== undefined && (
          <DiffEditor
            key={activeTab.id}
            language={languageForFile(activeTab.name)}
            original={workingBaselineCache[activeTab.path]}
            modified={activeTab.content}
            originalModelPath={`diff-baseline://${activeTab.path}`}
            modifiedModelPath={activeTab.path}
            keepCurrentModifiedModel
            theme="llmraki-dark"
            onMount={(diffEditorInstance, monaco) => {
              wireModifiedEditor(activeTab.id, diffEditorInstance.getModifiedEditor(), monaco)
            }}
            options={{
              fontSize: 13,
              renderSideBySide: false,
              automaticLayout: true,
              scrollBeyondLastLine: false
            }}
          />
        )}

      {!showingWelcome && activeTab && !(activeTab.diffMode && gitAvailable) && (
        <Editor
          key={activeTab.id}
          path={activeTab.path}
          keepCurrentModel
          language={languageForFile(activeTab.name)}
          value={activeTab.content}
          theme="llmraki-dark"
          onChange={(value) => onChange(activeTab.id, value ?? '')}
          onMount={(editorInstance, monaco) => wireModifiedEditor(activeTab.id, editorInstance, monaco)}
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
