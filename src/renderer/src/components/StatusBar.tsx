import { GitStatus } from '../types'
import { SourceControlIcon, WarningIcon, ErrorIcon } from './Icons'

interface Props {
  rootFolder: string | null
  activeFileName: string | null
  language: string | null
  cursor: { line: number; column: number } | null
  gitStatus: GitStatus | null
  onOpenSourceControl: () => void
  onOpenProblems: () => void
}

export default function StatusBar({
  rootFolder,
  activeFileName,
  language,
  cursor,
  gitStatus,
  onOpenSourceControl,
  onOpenProblems
}: Props): JSX.Element {
  const folderName = rootFolder ? rootFolder.split(/[/\\]/).filter(Boolean).pop() : null
  const changeCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  return (
    <div className="status-bar">
      {gitStatus?.isRepo && (
        <button className="status-bar-btn" onClick={onOpenSourceControl} title={gitStatus.branch ?? 'detached'}>
          <SourceControlIcon />
          <span className="status-bar-truncate">
            {gitStatus.branch ?? 'detached'}
            {changeCount > 0 ? `*` : ''}
          </span>
        </button>
      )}
      <button className="status-bar-btn" onClick={onOpenProblems} title="Problems">
        <ErrorIcon /> <span>0</span>
        <WarningIcon /> <span>0</span>
      </button>
      <span className="status-bar-truncate" title={folderName ?? undefined}>
        {folderName ?? 'No folder opened'}
      </span>
      {activeFileName && (
        <span className="status-bar-truncate" title={activeFileName}>
          {activeFileName}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 8 }} />
      {cursor && (
        <span className="status-bar-fixed">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      {language && (
        <span className="status-bar-fixed" style={{ textTransform: 'capitalize' }}>
          {language}
        </span>
      )}
      <span className="status-bar-fixed">LLMRaki</span>
    </div>
  )
}
