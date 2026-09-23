import { useEffect, useRef, useState } from 'react'
import TerminalInstance from './TerminalInstance'
import { TerminalIcon, CloseIcon } from './Icons'
import type { DebugOutputLine } from '../useDebugger'

type PanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'

interface TerminalTab {
  id: string
  label: string
  cwd: string | null
}

interface Props {
  visible: boolean
  activeTab: PanelTab
  onTabChange: (tab: PanelTab) => void
  rootFolder: string | null
  newTerminalSignal: number
  openTerminalAt: string | null
  onOpenTerminalAtConsumed: () => void
  runCommand: string | null
  onRunConsumed: () => void
  debugOutput: DebugOutputLine[]
  debugPaused: boolean
  onDebugEvaluate: (expression: string) => Promise<string>
  maximized: boolean
  onToggleMaximize: () => void
  onClose: () => void
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'problems', label: 'PROBLEMS' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'debug', label: 'DEBUG CONSOLE' },
  { id: 'terminal', label: 'TERMINAL' },
  { id: 'ports', label: 'PORTS' }
]

export default function BottomPanel({
  visible,
  activeTab,
  onTabChange,
  rootFolder,
  newTerminalSignal,
  openTerminalAt,
  onOpenTerminalAtConsumed,
  runCommand,
  onRunConsumed,
  debugOutput,
  debugPaused,
  onDebugEvaluate,
  maximized,
  onToggleMaximize,
  onClose
}: Props): JSX.Element {
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const counterRef = useRef(0)
  const lastSignalRef = useRef(0)
  const pendingCommandRef = useRef<string | null>(null)

  function addTerminal(cwd?: string | null): string {
    counterRef.current += 1
    const id = `term-${Date.now()}-${counterRef.current}`
    const effectiveCwd = cwd ?? rootFolder
    const label =
      cwd && cwd !== rootFolder
        ? `zsh · ${cwd.split(/[/\\]/).pop()}`
        : `zsh ${terminals.length + 1}`
    setTerminals((prev) => [...prev, { id, label, cwd: effectiveCwd }])
    setActiveTerminalId(id)
    return id
  }

  useEffect(() => {
    if (newTerminalSignal !== lastSignalRef.current) {
      lastSignalRef.current = newTerminalSignal
      addTerminal()
      onTabChange('terminal')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTerminalSignal])

  useEffect(() => {
    if (openTerminalAt) {
      addTerminal(openTerminalAt)
      onTabChange('terminal')
      onOpenTerminalAtConsumed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTerminalAt])

  useEffect(() => {
    if (runCommand) {
      const id = terminals.length > 0 ? activeTerminalId! : addTerminal()
      pendingCommandRef.current = runCommand
      setActiveTerminalId(id)
      onTabChange('terminal')
      onRunConsumed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCommand])

  function closeTerminal(id: string): void {
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeTerminalId === id) {
        setActiveTerminalId(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
  }

  if (!visible) return <></>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-tabbar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`panel-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {activeTab === 'terminal' && (
          <button className="close-btn" title="New Terminal" onClick={() => addTerminal()} style={{ marginRight: 4 }}>
            +
          </button>
        )}
        <button
          className="close-btn"
          title={maximized ? 'Restore Panel Size' : 'Maximize Panel Size'}
          onClick={onToggleMaximize}
          style={{ marginRight: 4, fontSize: 13 }}
        >
          {maximized ? '⤡' : '⤢'}
        </button>
        <button className="close-btn" title="Close Panel" onClick={onClose} style={{ marginRight: 8 }}>
          <CloseIcon />
        </button>
      </div>

      {activeTab === 'problems' && (
        <div className="empty-state" style={{ flex: 1, overflow: 'auto' }}>
          No problems have been detected. LLMRaki doesn't run a linter or type-checker in the
          background yet, so this list stays empty even if your code has issues.
        </div>
      )}

      {activeTab === 'output' && (
        <div className="empty-state" style={{ flex: 1, overflow: 'auto' }}>
          No output channels yet. This would show logs from build tasks or extensions if LLMRaki
          ran any in the background.
        </div>
      )}

      {activeTab === 'debug' && (
        <DebugConsole output={debugOutput} paused={debugPaused} onEvaluate={onDebugEvaluate} />
      )}

      {activeTab === 'ports' && (
        <div className="empty-state" style={{ flex: 1, overflow: 'auto' }}>
          No forwarded ports. LLMRaki doesn't monitor or forward local ports from processes you
          run in the terminal.
        </div>
      )}

      {activeTab === 'terminal' && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
            {terminals.length === 0 && (
              <div className="empty-state">
                <button onClick={() => addTerminal()}>New Terminal</button>
              </div>
            )}
            {terminals.map((t) => (
              <TerminalInstance
                key={t.id}
                id={t.id}
                cwd={t.cwd}
                active={activeTerminalId === t.id}
                pendingCommand={activeTerminalId === t.id ? pendingCommandRef.current : null}
                onCommandConsumed={() => {
                  pendingCommandRef.current = null
                }}
              />
            ))}
          </div>
          {terminals.length > 0 && (
            <div className="terminal-list">
              {terminals.map((t) => (
                <div
                  key={t.id}
                  className={`tree-item ${activeTerminalId === t.id ? 'selected' : ''}`}
                  onClick={() => setActiveTerminalId(t.id)}
                >
                  <TerminalIcon />
                  <span style={{ flex: 1, marginLeft: 6 }}>{t.label}</span>
                  <button
                    className="close-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTerminal(t.id)
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface DebugConsoleEntry {
  id: number
  kind: 'output' | 'input' | 'result'
  stream?: DebugOutputLine['stream']
  text: string
}

function DebugConsole({
  output,
  paused,
  onEvaluate
}: {
  output: DebugOutputLine[]
  paused: boolean
  onEvaluate: (expression: string) => Promise<string>
}): JSX.Element {
  const [expression, setExpression] = useState('')
  const [evalEntries, setEvalEntries] = useState<{ id: number; kind: 'input' | 'result'; text: string }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const evalCounter = useRef(0)

  const entries: DebugConsoleEntry[] = [
    ...output.map((o) => ({ id: o.id, kind: 'output' as const, stream: o.stream, text: o.text })),
    ...evalEntries
  ].sort((a, b) => a.id - b.id)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries.length])

  async function submit(): Promise<void> {
    const expr = expression.trim()
    if (!expr || !paused) return
    setExpression('')
    evalCounter.current -= 1
    const inputId = evalCounter.current
    setEvalEntries((prev) => [...prev, { id: inputId, kind: 'input', text: `> ${expr}` }])
    const result = await onEvaluate(expr)
    evalCounter.current -= 1
    setEvalEntries((prev) => [...prev, { id: evalCounter.current, kind: 'result', text: result }])
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '4px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
        {entries.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>
            No active debug session. Start debugging a JavaScript file from Run and Debug in the
            sidebar to see program output and evaluate expressions here.
          </div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              whiteSpace: 'pre-wrap',
              color:
                e.kind === 'input'
                  ? 'var(--accent-bright)'
                  : e.stream === 'stderr'
                    ? 'var(--danger)'
                    : e.kind === 'result'
                      ? 'var(--text-muted)'
                      : 'var(--text-primary)'
            }}
          >
            {e.text}
          </div>
        ))}
      </div>
      <input
        value={expression}
        onChange={(e) => setExpression(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
        disabled={!paused}
        placeholder={paused ? 'Evaluate an expression in the current frame…' : 'Pause at a breakpoint to evaluate expressions'}
        style={{
          border: 'none',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          padding: '6px 12px',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12
        }}
      />
    </div>
  )
}
