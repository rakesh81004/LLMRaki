import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { OpenTab, RecentFolder, WELCOME_TAB_ID } from '../types'
import { languageForFile } from '../utils/language'
import { CloseIcon } from './Icons'
import FileTypeBadge from './FileTypeBadge'
import WelcomeView from './WelcomeView'

interface Props {
  tabs: OpenTab[]
  activePath: string | null
  revealLine: number | null
  showWelcomeTab: boolean
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChange: (path: string, content: string) => void
  onSave: (path: string) => void
  onCursorChange: (line: number, column: number) => void
  onRevealed: () => void
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
  revealLine,
  showWelcomeTab,
  onSelectTab,
  onCloseTab,
  onChange,
  onSave,
  onCursorChange,
  onRevealed,
  welcomeProps
}: Props): JSX.Element {
  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const showingWelcome = activePath === WELCOME_TAB_ID
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

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

      {!showingWelcome && activeTab && (
        <Editor
          key={activeTab.path}
          language={languageForFile(activeTab.name)}
          value={activeTab.content}
          theme="llmraki-dark"
          onChange={(value) => onChange(activeTab.path, value ?? '')}
          onMount={(editorInstance, monaco) => {
            editorRef.current = editorInstance
            editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
              onSave(activeTab.path)
            )
            editorInstance.onDidChangeCursorPosition((e) => {
              onCursorChange(e.position.lineNumber, e.position.column)
            })
            if (revealLine !== null) {
              revealLineNow(editorInstance, revealLine)
              onRevealed()
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
