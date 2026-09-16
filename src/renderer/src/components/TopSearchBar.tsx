import { useEffect, useRef, useState } from 'react'
import { fuzzyMatch } from '../utils/fuzzy'
import HighlightedText from './HighlightedText'
import FileTypeBadge from './FileTypeBadge'

interface Props {
  rootFolder: string | null
  onOpenFile: (path: string) => void
}

function relativePath(root: string, filePath: string): string {
  return filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath
}

interface Ranked {
  file: string
  name: string
  nameIndices: number[]
  pathIndices: number[]
  score: number
}

export default function TopSearchBar({ rootFolder, onOpenFile }: Props): JSX.Element {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (rootFolder) {
      window.api.search.listFiles(rootFolder).then(setAllFiles)
    } else {
      setAllFiles([])
    }
  }, [rootFolder])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  let filtered: Ranked[] = []
  if (rootFolder) {
    if (!query) {
      filtered = allFiles.slice(0, 20).map((f) => ({
        file: f,
        name: f.split(/[/\\]/).pop() ?? f,
        nameIndices: [],
        pathIndices: [],
        score: 0
      }))
    } else {
      const ranked: Ranked[] = []
      for (const f of allFiles) {
        const rel = relativePath(rootFolder, f)
        const name = f.split(/[/\\]/).pop() ?? f
        const nameMatch = fuzzyMatch(name, query)
        const pathMatch = fuzzyMatch(rel, query)
        if (!nameMatch && !pathMatch) continue
        ranked.push({
          file: f,
          name,
          nameIndices: nameMatch?.indices ?? [],
          pathIndices: pathMatch?.indices ?? [],
          score: (nameMatch?.score ?? 0) * 2 + (pathMatch?.score ?? 0)
        })
      }
      ranked.sort((a, b) => b.score - a.score)
      filtered = ranked.slice(0, 20)
    }
  }

  useEffect(() => setActiveIndex(0), [query])

  function selectFile(path: string): void {
    onOpenFile(path)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (filtered[activeIndex]) selectFile(filtered[activeIndex].file)
    } else if (e.key === 'Escape') {
      setOpen(false)
      e.currentTarget.blur()
    }
  }

  return (
    <div className="titlebar-search" ref={containerRef}>
      <input
        placeholder={rootFolder ? 'Search files…' : 'Open a folder to search files'}
        value={query}
        disabled={!rootFolder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && rootFolder && (
        <div className="titlebar-search-dropdown">
          <div className="palette-list">
            {filtered.map((r, i) => (
              <div
                key={r.file}
                className={`palette-item ${i === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectFile(r.file)
                }}
              >
                <FileTypeBadge fileName={r.name} />
                <span className="item-name">
                  <HighlightedText text={r.name} indices={r.nameIndices} />
                </span>
                <span className="item-sub">
                  <HighlightedText
                    text={relativePath(rootFolder, r.file)}
                    indices={r.pathIndices}
                  />
                </span>
              </div>
            ))}
            {filtered.length === 0 && <div className="palette-item">No matching files</div>}
          </div>
        </div>
      )}
    </div>
  )
}
