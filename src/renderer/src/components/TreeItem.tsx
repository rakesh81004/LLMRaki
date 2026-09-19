import { useEffect, useRef, useState } from 'react'
import { FileEntry } from '../types'
import { ChevronIcon, FolderIcon } from './Icons'
import FileTypeBadge from './FileTypeBadge'

interface Props {
  entry: FileEntry
  depth: number
  selectedPath: string | null
  onSelectFile: (entry: FileEntry) => void
  onContextMenu: (entry: FileEntry, x: number, y: number) => void
  refreshToken: number
}

export default function TreeItem({
  entry,
  depth,
  selectedPath,
  onSelectFile,
  onContextMenu,
  refreshToken
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(false)

  async function handleClick(): Promise<void> {
    if (!entry.isDirectory) {
      onSelectFile(entry)
      return
    }
    if (!expanded && children === null) {
      setLoading(true)
      try {
        const result = await window.api.fs.readDir(entry.path)
        setChildren(result)
      } finally {
        setLoading(false)
      }
    }
    setExpanded(!expanded)
  }

  // Re-fetches this folder's children on any file-tree change elsewhere, but only if already expanded — otherwise stays lazily unloaded.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (entry.isDirectory && children !== null) {
      window.api.fs.readDir(entry.path).then(setChildren)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  return (
    <div>
      <div
        className={`tree-item ${selectedPath === entry.path ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(entry, e.clientX, e.clientY)
        }}
      >
        {entry.isDirectory ? (
          <span className={`chevron ${expanded ? 'expanded' : ''}`}>
            <ChevronIcon />
          </span>
        ) : (
          <span className="chevron" />
        )}
        <span className="file-icon">
          {entry.isDirectory ? <FolderIcon /> : <FileTypeBadge fileName={entry.name} />}
        </span>
        <span>{entry.name}</span>
      </div>
      {expanded && loading && (
        <div style={{ paddingLeft: 8 + (depth + 1) * 14, color: 'var(--text-muted)' }}>
          Loading…
        </div>
      )}
      {expanded &&
        children?.map((child) => (
          <TreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onContextMenu={onContextMenu}
            refreshToken={refreshToken}
          />
        ))}
    </div>
  )
}
