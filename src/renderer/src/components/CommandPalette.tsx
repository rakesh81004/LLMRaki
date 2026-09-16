import { useEffect, useState } from 'react'

export interface Command {
  id: string
  label: string
}

interface Props {
  commands: Command[]
  onRun: (id: string) => void
  onClose: () => void
}

export default function CommandPalette({ commands, onRun, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => setActiveIndex(0), [query])

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (filtered[activeIndex]) onRun(filtered[activeIndex].id)
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
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-list">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`palette-item ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onRun(c.id)}
            >
              <span>{c.label}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="palette-item">No matching commands</div>}
        </div>
      </div>
    </div>
  )
}
