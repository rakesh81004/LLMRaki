import { FileEntry } from '../types'
import TreeItem from './TreeItem'

interface Props {
  root: string | null
  entries: FileEntry[]
  selectedPath: string | null
  onOpenFile: (entry: FileEntry) => void
  onOpenFolder: () => void
  onContextMenu: (entry: FileEntry, x: number, y: number) => void
  refreshToken: number
}

export default function FileExplorer({
  root,
  entries,
  selectedPath,
  onOpenFile,
  onOpenFolder,
  onContextMenu,
  refreshToken
}: Props): JSX.Element {
  const folderName = root ? root.split(/[/\\]/).filter(Boolean).pop() : null

  return (
    <>
      <div className="sidebar-header">
        <span>{folderName ?? 'Explorer'}</span>
        {root && (
          <button title="Open a different folder" onClick={onOpenFolder}>
            ⋯
          </button>
        )}
      </div>
      <div className="sidebar-content">
        {!root && (
          <div className="empty-state">
            <div>No folder opened yet.</div>
            <button onClick={onOpenFolder}>Open Folder</button>
          </div>
        )}
        {root &&
          entries.map((entry) => (
            <TreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              selectedPath={selectedPath}
              onSelectFile={onOpenFile}
              onContextMenu={onContextMenu}
              refreshToken={refreshToken}
            />
          ))}
      </div>
    </>
  )
}
