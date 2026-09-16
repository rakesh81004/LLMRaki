interface Props {
  activeFileName: string | null
  onRun: (command: string) => void
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

export default function RunPanel({ activeFileName, onRun }: Props): JSX.Element {
  const ext = activeFileName?.split('.').pop()?.toLowerCase()
  const runner = ext ? RUNNERS[ext] : undefined

  return (
    <>
      <div className="sidebar-header">
        <span>Run and Debug</span>
      </div>
      <div className="empty-state">
        <div>No launch configuration found.</div>
        <div style={{ marginTop: 10 }}>
          {activeFileName && runner ? (
            <button onClick={() => onRun(runner(activeFileName))}>Run "{activeFileName}"</button>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>
              Open a .js, .ts, .py, .rb, .sh, or .go file to run it directly in the terminal.
            </div>
          )}
        </div>
        <div className="description" style={{ marginTop: 14 }}>
          Full step-through debugging (breakpoints, call stack, watch expressions) isn't
          implemented — this runs the active file as a plain process in the integrated terminal.
        </div>
      </div>
    </>
  )
}
