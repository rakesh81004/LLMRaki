import { useEffect, useState } from 'react'
import type { DebugVariable } from '../types'
import type { DebugState } from '../useDebugger'

interface Props {
  activeFileName: string | null
  activeFilePath: string | null
  onRun: (command: string) => void
  debugState: DebugState
  breakpoints: Record<string, number[]>
  onStartDebugging: (path: string) => void
  onStop: () => void
  onContinue: () => void
  onStepOver: () => void
  onStepInto: () => void
  onStepOut: () => void
  onSelectFrame: (index: number) => void
  onOpenFile: (path: string, line?: number) => void
  onToggleBreakpoint: (path: string, line: number) => void
  getVariables: (objectId: string) => Promise<DebugVariable[]>
}

const RUNNERS: Record<string, (file: string) => string> = {
  js: (f) => `node "${f}"`,
  mjs: (f) => `node "${f}"`,
  ts: (f) => `npx tsx "${f}"`,
  py: (f) => `python3 "${f}"`,
  rb: (f) => `ruby "${f}"`,
  sh: (f) => `bash "${f}"`,
  go: (f) => `go run "${f}"`
}

// Real breakpoint/step-through debugging talks to Node's own inspector protocol, which only
// applies to plain JavaScript — .ts still runs via the plain-process "Run" path above, since
// mapping breakpoints through a transpiler's source maps isn't implemented.
const DEBUGGABLE_EXTENSIONS = new Set(['js', 'mjs'])

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function ScopeNode({
  label,
  objectId,
  getVariables
}: {
  label: string
  objectId: string
  getVariables: (objectId: string) => Promise<DebugVariable[]>
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const [vars, setVars] = useState<DebugVariable[] | null>(null)

  useEffect(() => {
    if (open && vars === null) {
      getVariables(objectId).then(setVars)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, objectId])

  return (
    <div>
      <div className="tree-item" onClick={() => setOpen((v) => !v)}>
        <span style={{ width: 12 }}>{open ? '▾' : '▸'}</span>
        <span>{label}</span>
      </div>
      {open &&
        (vars ?? []).map((v) => (
          <VariableNode key={v.name} variable={v} getVariables={getVariables} depth={1} />
        ))}
    </div>
  )
}

function VariableNode({
  variable,
  getVariables,
  depth
}: {
  variable: DebugVariable
  getVariables: (objectId: string) => Promise<DebugVariable[]>
  depth: number
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DebugVariable[] | null>(null)
  const value = variable.value
  const expandable = value?.type === 'object' && Boolean(value.objectId) && value.subtype !== 'null'

  function toggle(): void {
    if (!expandable || !value?.objectId) return
    if (!open && children === null) {
      getVariables(value.objectId).then(setChildren)
    }
    setOpen((v) => !v)
  }

  const display = !value
    ? '(getter/setter)'
    : value.value !== undefined
      ? JSON.stringify(value.value)
      : (value.description ?? value.className ?? value.type)

  return (
    <div>
      <div className="tree-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={toggle}>
        <span style={{ width: 12 }}>{expandable ? (open ? '▾' : '▸') : ''}</span>
        <span style={{ color: 'var(--accent-bright)' }}>{variable.name}</span>
        <span style={{ marginLeft: 6, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {display}
        </span>
      </div>
      {open &&
        (children ?? []).map((c) => (
          <VariableNode key={c.name} variable={c} getVariables={getVariables} depth={depth + 1} />
        ))}
    </div>
  )
}

export default function RunPanel({
  activeFileName,
  activeFilePath,
  onRun,
  debugState,
  breakpoints,
  onStartDebugging,
  onStop,
  onContinue,
  onStepOver,
  onStepInto,
  onStepOut,
  onSelectFrame,
  onOpenFile,
  onToggleBreakpoint,
  getVariables
}: Props): JSX.Element {
  const ext = activeFileName?.split('.').pop()?.toLowerCase()
  const runner = ext ? RUNNERS[ext] : undefined
  const canDebug = ext ? DEBUGGABLE_EXTENSIONS.has(ext) : false
  const sessionActive = debugState.status !== 'idle' && debugState.status !== 'terminated'
  const isPaused = debugState.status === 'paused'
  const activeFrame = debugState.callFrames[debugState.activeFrameIndex]

  const allBreakpoints = Object.entries(breakpoints).flatMap(([path, lines]) =>
    lines.map((line) => ({ path, line }))
  )

  return (
    <>
      <div className="sidebar-header">
        <span>Run and Debug</span>
      </div>

      {sessionActive && (
        <div className="debug-toolbar">
          <button disabled={!isPaused} title="Continue" onClick={onContinue}>
            ▶
          </button>
          <button disabled={!isPaused} title="Step Over" onClick={onStepOver}>
            ⤵
          </button>
          <button disabled={!isPaused} title="Step Into" onClick={onStepInto}>
            ⇥
          </button>
          <button disabled={!isPaused} title="Step Out" onClick={onStepOut}>
            ⇤
          </button>
          <div style={{ flex: 1 }} />
          <button title="Stop" onClick={onStop}>
            ◼
          </button>
        </div>
      )}

      {!sessionActive && (
        <div className="empty-state">
          <div>No launch configuration found.</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeFileName && runner && (
              <button onClick={() => onRun(runner(activeFileName))}>Run "{activeFileName}"</button>
            )}
            {activeFilePath && canDebug && (
              <button onClick={() => onStartDebugging(activeFilePath)}>▶ Debug "{activeFileName}"</button>
            )}
          </div>
          {!runner && (
            <div style={{ color: 'var(--text-muted)', marginTop: 10 }}>
              Open a .js, .ts, .py, .rb, .sh, or .go file to run it directly in the terminal.
            </div>
          )}
          <div className="description" style={{ marginTop: 14 }}>
            Real breakpoints, call stack, and variable inspection are available for plain
            JavaScript (.js/.mjs) files, via Node's own inspector protocol. Other languages, and
            .ts (which runs through a transpiler), still just run as a plain process in the
            terminal.
          </div>
        </div>
      )}

      {sessionActive && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div className="run-section-header">CALL STACK</div>
          {debugState.callFrames.length === 0 && (
            <div className="empty-state" style={{ padding: '4px 12px' }}>
              {debugState.status === 'starting' ? 'Starting…' : 'Running'}
            </div>
          )}
          {debugState.callFrames.map((frame, i) => (
            <div
              key={frame.callFrameId}
              className={`tree-item ${i === debugState.activeFrameIndex ? 'selected' : ''}`}
              onClick={() => {
                onSelectFrame(i)
                onOpenFile(frame.path, frame.line)
              }}
            >
              <span style={{ flex: 1 }}>{frame.functionName}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {baseName(frame.path)}:{frame.line}
              </span>
            </div>
          ))}

          {isPaused && activeFrame && (
            <>
              <div className="run-section-header">VARIABLES</div>
              {activeFrame.scopes.map((scope) =>
                scope.objectId ? (
                  <ScopeNode
                    key={scope.objectId}
                    label={scope.name || scope.type}
                    objectId={scope.objectId}
                    getVariables={getVariables}
                  />
                ) : null
              )}
            </>
          )}

          <div className="run-section-header">BREAKPOINTS</div>
          {allBreakpoints.length === 0 && (
            <div className="empty-state" style={{ padding: '4px 12px' }}>
              No breakpoints set. Click in a JavaScript file's gutter to add one.
            </div>
          )}
          {allBreakpoints.map((bp) => (
            <div
              key={`${bp.path}:${bp.line}`}
              className="tree-item"
              onClick={() => onOpenFile(bp.path, bp.line)}
            >
              <span className="breakpoint-dot" />
              <span style={{ flex: 1, marginLeft: 6 }}>
                {baseName(bp.path)}:{bp.line}
              </span>
              <button
                className="close-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleBreakpoint(bp.path, bp.line)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
