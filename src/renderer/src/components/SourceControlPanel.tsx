import { useEffect, useMemo, useState } from 'react'
import { GitStatus, GitCommit } from '../types'
import { buildGitGraph, parseRefs, REF_KIND_COLORS, RefKind } from '../gitGraph'
import { parseUnifiedDiff, FileDiff } from '../diffParser'
import DiffLinesView from './DiffLinesView'
import { diffLines, opsToDiffLines, diffStats } from '../lineDiff'
import FileTypeBadge from './FileTypeBadge'

interface Props {
  rootFolder: string | null
  onOpenFile: (filePath: string) => void
  onStatusChange: (status: GitStatus | null) => void
  refreshToken: number
}

export default function SourceControlPanel({
  rootFolder,
  onOpenFile,
  onStatusChange,
  refreshToken
}: Props): JSX.Element {
  const [gitRoot, setGitRoot] = useState<string | null>(null)
  const [resolvingRoot, setResolvingRoot] = useState(false)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState<{ title: string; files: FileDiff[] } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState(0)
  const [error, setError] = useState('')
  const [view, setView] = useState<'changes' | 'history'>('changes')
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loadingLog, setLoadingLog] = useState(false)
  const graph = useMemo(() => buildGitGraph(commits), [commits])

  async function refresh(): Promise<void> {
    if (!gitRoot) {
      setStatus(null)
      onStatusChange(null)
      return
    }
    try {
      const result = await window.api.git.status(gitRoot)
      setStatus(result)
      onStatusChange(result)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // `git rev-parse` only looks upward from a directory, so if the actual `.git` lives in a subfolder (e.g. monorepo layout), search for that nested repo instead of reporting "not a repository."
  useEffect(() => {
    if (!rootFolder) {
      setGitRoot(null)
      return
    }
    let cancelled = false
    setResolvingRoot(true)
    window.api.git.findRoot(rootFolder).then((found) => {
      if (cancelled) return
      setGitRoot(found)
      setResolvingRoot(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder, refreshToken])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitRoot, refreshToken])

  async function loadLog(): Promise<void> {
    if (!gitRoot) return
    setLoadingLog(true)
    try {
      const log = await window.api.git.log(gitRoot)
      setCommits(log)
    } finally {
      setLoadingLog(false)
    }
  }

  useEffect(() => {
    if (view === 'history') loadLog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, gitRoot, refreshToken])

  async function handleViewCommit(commit: GitCommit): Promise<void> {
    if (!gitRoot) return
    const text = await window.api.git.show(gitRoot, commit.hash)
    setSelectedDiffFile(0)
    setDiff({ title: `${commit.shortHash} — ${commit.message}`, files: parseUnifiedDiff(text) })
  }

  function relativePath(filePath: string): string {
    if (!gitRoot) return filePath
    return filePath.startsWith(gitRoot) ? filePath.slice(gitRoot.length + 1) : filePath
  }

  async function handleStage(path: string): Promise<void> {
    if (!gitRoot) return
    await window.api.git.stage(gitRoot, path)
    refresh()
  }

  async function handleUnstage(path: string): Promise<void> {
    if (!gitRoot) return
    await window.api.git.unstage(gitRoot, path)
    refresh()
  }

  async function handleDiscard(path: string): Promise<void> {
    if (!gitRoot) return
    if (!window.confirm(`Discard changes to "${relativePath(path)}"? This cannot be undone.`)) return
    await window.api.git.discard(gitRoot, path)
    refresh()
  }

  async function handleUnstageAll(): Promise<void> {
    if (!gitRoot || !status) return
    await Promise.all(status.staged.map((f) => window.api.git.unstage(gitRoot, f.path)))
    refresh()
  }

  async function handleStageAll(): Promise<void> {
    if (!gitRoot) return
    await window.api.git.stageAll(gitRoot)
    refresh()
  }

  async function handleDiscardAll(): Promise<void> {
    if (!gitRoot || !status) return
    if (status.unstaged.length === 0) return
    if (!window.confirm(`Discard changes to ${status.unstaged.length} file(s)? This cannot be undone.`)) return
    await Promise.all(status.unstaged.map((f) => window.api.git.discard(gitRoot, f.path)))
    refresh()
  }

  async function handleViewDiff(path: string, staged: boolean): Promise<void> {
    if (!gitRoot) return
    const text = await window.api.git.diff(gitRoot, path, staged)
    setSelectedDiffFile(0)
    setDiff({ title: path, files: parseUnifiedDiff(text) })
  }

  async function handleViewUntrackedDiff(path: string): Promise<void> {
    if (!gitRoot) return
    try {
      const content = await window.api.fs.readFile(`${gitRoot}/${path}`)
      const ops = diffLines('', content)
      const stats = diffStats(ops)
      setSelectedDiffFile(0)
      setDiff({
        title: path,
        files: [
          {
            path,
            oldPath: null,
            isNew: true,
            isDeleted: false,
            isRenamed: false,
            added: stats.added,
            removed: stats.removed,
            lines: opsToDiffLines(ops)
          }
        ]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCommit(): Promise<void> {
    if (!gitRoot || !message.trim() || !status) return
    setBusy(true)
    try {
      if (status.staged.length === 0) {
        await window.api.git.stageAll(gitRoot)
      }
      await window.api.git.commit(gitRoot, message.trim())
      setMessage('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePush(): Promise<void> {
    if (!gitRoot) return
    setBusy(true)
    try {
      await window.api.git.push(gitRoot)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePull(): Promise<void> {
    if (!gitRoot) return
    setBusy(true)
    try {
      await window.api.git.pull(gitRoot)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!rootFolder) {
    return (
      <>
        <div className="sidebar-header">
          <span>Source Control</span>
        </div>
        <div className="empty-state">Open a folder to see source control status.</div>
      </>
    )
  }

  if (resolvingRoot) {
    return (
      <>
        <div className="sidebar-header">
          <span>Source Control</span>
        </div>
        <div className="empty-state">Checking for a Git repository…</div>
      </>
    )
  }

  if (!gitRoot) {
    return (
      <>
        <div className="sidebar-header">
          <span>Source Control</span>
        </div>
        <div className="empty-state">
          No Git repository found in this folder (checked it and its immediate subfolders).
        </div>
      </>
    )
  }

  const gitRootLabel =
    gitRoot !== rootFolder ? gitRoot.slice(rootFolder.length + 1) || gitRoot : null

  const untrackedAsChanges = status?.untracked ?? []
  const unstaged = status?.unstaged ?? []
  const staged = status?.staged ?? []

  return (
    <>
      <div className="sidebar-header">
        <span>Source Control</span>
        <div className="scm-toolbar">
          <button className="scm-icon-btn" title="Pull" onClick={handlePull} disabled={busy}>
            ⭳
          </button>
          <button className="scm-icon-btn" title="Push" onClick={handlePush} disabled={busy}>
            ⭱
          </button>
          <button className="scm-icon-btn" title="Refresh" onClick={refresh}>
            ⟳
          </button>
        </div>
      </div>
      {gitRootLabel && (
        <div style={{ padding: '0 12px 4px', fontSize: 10, color: 'var(--text-muted)' }}>
          Using nested repo: {gitRootLabel}
        </div>
      )}
      <div style={{ padding: '0 12px 8px' }}>
        <textarea
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{
            width: '100%',
            minHeight: 50,
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: 6,
            resize: 'none'
          }}
        />
        <button
          className="btn"
          style={{ width: '100%', marginTop: 6 }}
          disabled={busy || !message.trim() || (staged.length === 0 && unstaged.length === 0 && untrackedAsChanges.length === 0)}
          onClick={handleCommit}
        >
          Commit{staged.length === 0 ? ' All' : ''}
        </button>
        {status && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Branch: {status.branch ?? 'detached'}
            {status.ahead > 0 && ` ↑${status.ahead}`}
            {status.behind > 0 && ` ↓${status.behind}`}
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setView('changes')}
          style={{
            background: 'none',
            border: 'none',
            padding: '6px 12px',
            color: view === 'changes' ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: view === 'changes' ? '2px solid var(--accent-bright)' : '2px solid transparent',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}
        >
          Changes
        </button>
        <button
          onClick={() => setView('history')}
          style={{
            background: 'none',
            border: 'none',
            padding: '6px 12px',
            color: view === 'history' ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: view === 'history' ? '2px solid var(--accent-bright)' : '2px solid transparent',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}
        >
          History
        </button>
      </div>

      {view === 'history' && (
        <div className="sidebar-content">
          {loadingLog && <div className="empty-state">Loading history…</div>}
          {!loadingLog && commits.length === 0 && (
            <div className="empty-state">No commits found on this branch.</div>
          )}
          {!loadingLog &&
            graph.rows.map((row) => {
              const commit = row.commit
              const ROW_H = 34
              const LANE_W = 12
              const MID = ROW_H / 2
              const cx = (lane: number): number => 6 + lane * LANE_W
              const rowLanes = [
                row.lane,
                ...row.topStraight.map((s) => s.lane),
                ...row.bottomStraight.map((s) => s.lane),
                ...row.topCurvesIn.flatMap((c) => [c.from, c.to]),
                ...row.bottomCurvesOut.flatMap((c) => [c.from, c.to])
              ]
              const rowMaxLane = Math.max(...rowLanes)
              const svgWidth = (rowMaxLane + 1) * LANE_W + 6
              const refs = parseRefs(commit.refs)

              return (
                <div
                  key={commit.hash}
                  className="tree-item"
                  style={{ alignItems: 'flex-start', padding: '0 8px 0 2px', gap: 0, height: ROW_H }}
                  onClick={() => handleViewCommit(commit)}
                  title={commit.message}
                >
                  <svg width={svgWidth} height={ROW_H} style={{ flexShrink: 0, overflow: 'visible' }}>
                    {row.topStraight.map((s, i) => (
                      <line
                        key={`ts${i}`}
                        x1={cx(s.lane)}
                        y1={0}
                        x2={cx(s.lane)}
                        y2={MID}
                        stroke={s.color}
                        strokeWidth={2}
                      />
                    ))}
                    {row.bottomStraight.map((s, i) => (
                      <line
                        key={`bs${i}`}
                        x1={cx(s.lane)}
                        y1={MID}
                        x2={cx(s.lane)}
                        y2={ROW_H}
                        stroke={s.color}
                        strokeWidth={2}
                      />
                    ))}
                    {row.hasTopLine && (
                      <line x1={cx(row.lane)} y1={0} x2={cx(row.lane)} y2={MID} stroke={row.color} strokeWidth={2} />
                    )}
                    {row.hasBottomLine && (
                      <line
                        x1={cx(row.lane)}
                        y1={MID}
                        x2={cx(row.lane)}
                        y2={ROW_H}
                        stroke={row.color}
                        strokeWidth={2}
                      />
                    )}
                    {row.topCurvesIn.map((c, i) => {
                      const x1 = cx(c.from)
                      const x2 = cx(c.to)
                      return (
                        <path
                          key={`tc${i}`}
                          d={`M ${x1} 0 C ${x1} ${MID * 0.6}, ${x2} ${MID * 0.4}, ${x2} ${MID}`}
                          stroke={c.color}
                          strokeWidth={2}
                          fill="none"
                        />
                      )
                    })}
                    {row.bottomCurvesOut.map((c, i) => {
                      const x1 = cx(c.from)
                      const x2 = cx(c.to)
                      return (
                        <path
                          key={`bc${i}`}
                          d={`M ${x1} ${MID} C ${x1} ${MID + (ROW_H - MID) * 0.4}, ${x2} ${MID + (ROW_H - MID) * 0.6}, ${x2} ${ROW_H}`}
                          stroke={c.color}
                          strokeWidth={2}
                          fill="none"
                        />
                      )
                    })}
                    {row.isMerge ? (
                      <circle
                        cx={cx(row.lane)}
                        cy={MID}
                        r={4}
                        fill="var(--bg-sidebar)"
                        stroke={row.color}
                        strokeWidth={2}
                      />
                    ) : (
                      <circle cx={cx(row.lane)} cy={MID} r={3.5} fill={row.color} />
                    )}
                    {row.isHead && (
                      <circle cx={cx(row.lane)} cy={MID} r={6} fill="none" stroke={row.color} strokeWidth={1.3} opacity={0.6} />
                    )}
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12
                      }}
                    >
                      {commit.message}
                      {refs.map((r, i) => (
                        <RefBadge key={i} kind={r.kind} label={r.label} />
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      <code style={{ background: 'none' }}>{commit.shortHash}</code> · {commit.author} ·{' '}
                      {commit.date}
                      {row.isMerge && ' · merge'}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {view === 'changes' && (
      <div className="sidebar-content">
        {staged.length === 0 && unstaged.length === 0 && untrackedAsChanges.length === 0 && (
          <div className="empty-state">No changes.</div>
        )}

        {staged.length > 0 && (
          <>
            <div className="scm-section-header">
              <span>Staged Changes</span>
              <div className="scm-section-actions">
                <button className="scm-icon-btn" title="Unstage All Changes" onClick={handleUnstageAll}>
                  −
                </button>
                <span className="scm-count-badge">{staged.length}</span>
              </div>
            </div>
            {staged.map((f) => (
              <div key={f.path} className="tree-item scm-file-row" onClick={() => handleViewDiff(f.path, true)}>
                <FileTypeBadge fileName={f.path.split(/[/\\]/).pop() ?? f.path} />
                <span className="scm-file-name">{f.path}</span>
                <button
                  className="scm-row-btn"
                  title="Open file"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenFile(`${gitRoot}/${f.path}`)
                  }}
                >
                  📄
                </button>
                <button
                  className="scm-row-btn"
                  title="Unstage"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleUnstage(f.path)
                  }}
                >
                  −
                </button>
                <span className="scm-status-letter" style={{ color: 'var(--success)' }}>{f.index}</span>
              </div>
            ))}
          </>
        )}

        {(unstaged.length > 0 || untrackedAsChanges.length > 0) && (
          <>
            <div className="scm-section-header">
              <span>Changes</span>
              <div className="scm-section-actions">
                <button className="scm-icon-btn" title="Discard All Changes" onClick={handleDiscardAll}>
                  ↺
                </button>
                <button className="scm-icon-btn" title="Stage All Changes" onClick={handleStageAll}>
                  +
                </button>
                <span className="scm-count-badge">{unstaged.length + untrackedAsChanges.length}</span>
              </div>
            </div>
            {unstaged.map((f) => (
              <div key={f.path} className="tree-item scm-file-row" onClick={() => handleViewDiff(f.path, false)}>
                <FileTypeBadge fileName={f.path.split(/[/\\]/).pop() ?? f.path} />
                <span className="scm-file-name">{f.path}</span>
                <button
                  className="scm-row-btn"
                  title="Open file"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenFile(`${gitRoot}/${f.path}`)
                  }}
                >
                  📄
                </button>
                <button
                  className="scm-row-btn"
                  title="Discard changes"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDiscard(f.path)
                  }}
                >
                  ↺
                </button>
                <button
                  className="scm-row-btn"
                  title="Stage"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStage(f.path)
                  }}
                >
                  +
                </button>
                <span className="scm-status-letter" style={{ color: 'var(--accent-bright)' }}>{f.workingTree}</span>
              </div>
            ))}
            {untrackedAsChanges.map((f) => (
              <div key={f.path} className="tree-item scm-file-row" onClick={() => handleViewUntrackedDiff(f.path)}>
                <FileTypeBadge fileName={f.path.split(/[/\\]/).pop() ?? f.path} />
                <span className="scm-file-name">{f.path}</span>
                <button
                  className="scm-row-btn"
                  title="Open file"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenFile(`${gitRoot}/${f.path}`)
                  }}
                >
                  📄
                </button>
                <button
                  className="scm-row-btn"
                  title="Stage"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStage(f.path)
                  }}
                >
                  +
                </button>
                <span className="scm-status-letter" style={{ color: 'var(--success)' }}>U</span>
              </div>
            ))}
          </>
        )}
      </div>
      )}

      {diff && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
          onClick={() => setDiff(null)}
        >
          <div
            style={{
              width: '85%',
              maxWidth: 1200,
              height: '80%',
              background: 'var(--bg-editor)',
              border: '1px solid var(--hairline)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-float)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '8px 14px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {diff.title}
              </span>
              <button className="close-btn" onClick={() => setDiff(null)}>
                ✕
              </button>
            </div>
            {diff.files.length === 0 ? (
              <div className="empty-state">No textual diff available (binary file or no changes).</div>
            ) : (
              <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                {diff.files.length > 1 && (
                  <div
                    style={{
                      width: 260,
                      flexShrink: 0,
                      borderRight: '1px solid var(--border)',
                      overflowY: 'auto'
                    }}
                  >
                    <div style={{ padding: '6px 12px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      {diff.files.length} files changed
                    </div>
                    {diff.files.map((f, i) => (
                      <div
                        key={f.path + i}
                        className="tree-item"
                        style={{ background: i === selectedDiffFile ? 'var(--bg-active)' : undefined }}
                        onClick={() => setSelectedDiffFile(i)}
                        title={f.path}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}>
                          {f.path.split('/').pop()}
                        </span>
                        {f.added > 0 && (
                          <span style={{ color: 'var(--success)', fontSize: 10 }}>+{f.added}</span>
                        )}
                        {f.removed > 0 && (
                          <span style={{ color: 'var(--danger)', fontSize: 10, marginLeft: 4 }}>−{f.removed}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <DiffFileView
                  key={selectedDiffFile}
                  file={diff.files[selectedDiffFile] ?? diff.files[0]}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function RefBadge({ kind, label }: { kind: RefKind; label: string }): JSX.Element {
  const color = REF_KIND_COLORS[kind]
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 5,
        padding: '1px 6px',
        fontSize: 9,
        fontWeight: 600,
        borderRadius: 10,
        background: `${color}26`,
        color,
        border: `1px solid ${color}66`,
        whiteSpace: 'nowrap'
      }}
    >
      {kind === 'head' ? `◆ ${label}` : label}
    </span>
  )
}

function DiffFileView({ file }: { file: FileDiff }): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {file.isNew && <span style={{ fontSize: 10, color: 'var(--success)' }}>new file</span>}
        {file.isDeleted && <span style={{ fontSize: 10, color: 'var(--danger)' }}>deleted</span>}
        {file.added > 0 && <span style={{ fontSize: 11, color: 'var(--success)' }}>+{file.added}</span>}
        {file.removed > 0 && <span style={{ fontSize: 11, color: 'var(--danger)' }}>−{file.removed}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <DiffLinesView lines={file.lines} fileName={file.path} />
      </div>
    </div>
  )
}
