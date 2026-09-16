import { RecentFolder } from '../types'
import { FilesIcon, FolderIcon, CloseIcon } from './Icons'

interface Props {
  recentFolders: RecentFolder[]
  onNewFile: () => void
  onOpenFolder: () => void
  onOpenRecent: (folderPath: string) => void
  onRemoveRecent: (folderPath: string) => void
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function parentDir(folderPath: string): string {
  const parts = folderPath.split(/[/\\]/).filter(Boolean)
  parts.pop()
  return '~/' + (parts.slice(-2).join('/') || '')
}

export default function WelcomeView({
  recentFolders,
  onNewFile,
  onOpenFolder,
  onOpenRecent,
  onRemoveRecent
}: Props): JSX.Element {
  return (
    <div className="welcome-view">
      <div className="welcome-header">
        <h1>LLMRaki</h1>
        <div className="welcome-tagline">A VS Code-style editor with a built-in AI assistant</div>
      </div>

      <div className="welcome-columns">
        <div className="welcome-column">
          <h2>Start</h2>
          <button className="welcome-link" onClick={onNewFile}>
            <FilesIcon /> <span>New File…</span>
          </button>
          <button className="welcome-link" onClick={onOpenFolder}>
            <FolderIcon /> <span>Open Folder…</span>
          </button>
        </div>

        <div className="welcome-column">
          <h2>Recent</h2>
          {recentFolders.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              No recent folders yet — open one to see it here.
            </div>
          )}
          {recentFolders.map((f) => (
            <div key={f.path} className="welcome-recent-item">
              <button className="welcome-link" style={{ flex: 1 }} onClick={() => onOpenRecent(f.path)}>
                <FolderIcon />
                <span className="welcome-link-text">
                  <span className="welcome-link-title">{f.name}</span>
                  <span className="item-sub">{parentDir(f.path)}</span>
                </span>
              </button>
              <span className="item-sub" style={{ marginRight: 6 }}>
                {timeAgo(f.lastOpened)}
              </span>
              <button
                className="close-btn"
                title="Remove from Recent"
                onClick={() => onRemoveRecent(f.path)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
