import { useEffect, useState } from 'react'
import { fuzzyMatch } from '../utils/fuzzy'
import HighlightedText from './HighlightedText'
import FileTypeBadge from './FileTypeBadge'

interface Props {
  rootFolder: string
  onSelect: (filePath: string) => void
  onClose: () => void
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

export default function QuickOpen({ rootFolder, onSelect, onClose }: Props): JSX.Element {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    window.api.search.listFiles(rootFolder).then(setAllFiles)
  }, [rootFolder])

  let filtered: Ranked[]
  if (!query) {
    filtered = allFiles.slice(0, 100).map((f) => ({
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
    filtered = ranked.slice(0, 100)
  }

  useEffect(() => setActiveIndex(0), [query])

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (filtered[activeIndex]) onSelect(filtered[activeIndex].file)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Go to file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-list">
          {filtered.map((r, i) => (
            <div
              key={r.file}
              className={`palette-item ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onSelect(r.file)}
            >
              <FileTypeBadge fileName={r.name} />
              <span className="item-name">
                <HighlightedText text={r.name} indices={r.nameIndices} />
              </span>
              <span className="item-sub">
                <HighlightedText text={relativePath(rootFolder, r.file)} indices={r.pathIndices} />
              </span>
            </div>
          ))}
          {filtered.length === 0 && <div className="palette-item">No matching files</div>}
        </div>
      </div>
    </div>
  )
}
