import { useEffect, useRef, useState } from 'react'
import { FileEntry } from '../types'
import { FolderIcon } from './Icons'
import FileTypeBadge from './FileTypeBadge'

export interface SymbolCrumb {
  name: string
  offset: number
}

interface Props {
  rootFolder: string
  filePath: string
  symbolPath: SymbolCrumb[]
  onOpenFile: (path: string) => void
  onJumpToOffset: (offset: number) => void
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/')
}

export default function Breadcrumbs({
  rootFolder,
  filePath,
  symbolPath,
  onOpenFile,
  onJumpToOffset
}: Props): JSX.Element {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [browsingDir, setBrowsingDir] = useState('')
  const [highlightPath, setHighlightPath] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenKey(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const normRoot = normalize(rootFolder)
  const normFile = normalize(filePath)
  const rel = normFile.startsWith(normRoot + '/') ? normFile.slice(normRoot.length + 1) : normFile
  const parts = rel.split('/').filter(Boolean)

  function segmentPath(index: number): string {
    return [normRoot, ...parts.slice(0, index + 1)].join('/')
  }

  async function openSegmentDropdown(index: number): Promise<void> {
    const key = `path-${index}`
    if (openKey === key) {
      setOpenKey(null)
      return
    }
    const parentPath = index === 0 ? normRoot : segmentPath(index - 1)
    const highlight = segmentPath(index)
    const result = await window.api.fs.readDir(parentPath)
    setEntries(result)
    setBrowsingDir(parentPath)
    setHighlightPath(highlight)
    setOpenKey(key)
  }

  async function handleEntryClick(entry: FileEntry): Promise<void> {
    if (entry.isDirectory) {
      const result = await window.api.fs.readDir(entry.path)
      setEntries(result)
      setBrowsingDir(entry.path)
      setHighlightPath(entry.path)
      return
    }
    onOpenFile(entry.path)
    setOpenKey(null)
  }

  return (
    <div className="breadcrumbs" ref={containerRef}>
      {parts.map((part, i) => (
        <span key={`path-${i}`} className="breadcrumb-seg-wrap">
          <button className="breadcrumb-seg" onClick={() => openSegmentDropdown(i)}>
            {part}
          </button>
          <span className="breadcrumb-sep">›</span>
          {openKey === `path-${i}` && (
            <div className="breadcrumb-dropdown">
              <div className="breadcrumb-dropdown-path">{browsingDir.replace(normRoot, '') || '/'}</div>
              {entries.map((entry) => (
                <div
                  key={entry.path}
                  className={`breadcrumb-dropdown-item ${entry.path === highlightPath ? 'active' : ''}`}
                  onClick={() => handleEntryClick(entry)}
                >
                  {entry.isDirectory ? <FolderIcon /> : <FileTypeBadge fileName={entry.name} />}
                  <span>{entry.name}</span>
                </div>
              ))}
            </div>
          )}
        </span>
      ))}
      {symbolPath.map((s, i) => (
        <span key={`sym-${i}`} className="breadcrumb-seg-wrap">
          <button
            className="breadcrumb-seg breadcrumb-symbol"
            onClick={() => onJumpToOffset(s.offset)}
          >
            {s.name}
          </button>
          {i < symbolPath.length - 1 && <span className="breadcrumb-sep">›</span>}
        </span>
      ))}
    </div>
  )
}
