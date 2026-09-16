import { useMemo, useState } from 'react'
import { DiffLine, groupDiffLines } from '../diffParser'
import DiffLineRow from './DiffLineRow'

export default function DiffLinesView({ lines, context = 3 }: { lines: DiffLine[]; context?: number }): JSX.Element {
  const items = useMemo(() => groupDiffLines(lines, context), [lines, context])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  return (
    <div style={{ fontFamily: 'Menlo, Consolas, monospace', fontSize: 12 }}>
      {items.map((item, i) => {
        if (item.kind === 'line') return <DiffLineRow key={i} line={item.line} />
        const isOpen = expanded.has(i)
        if (isOpen) {
          return (
            <div key={i}>
              {item.lines.map((l, j) => (
                <DiffLineRow key={j} line={l} />
              ))}
            </div>
          )
        }
        return (
          <div
            key={i}
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev)
                next.add(i)
                return next
              })
            }
            style={{
              padding: '3px 12px 3px 98px',
              color: 'var(--text-muted)',
              background: 'var(--bg-hover)',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            ⋯ {item.lines.length} hidden lines
          </div>
        )
      })}
    </div>
  )
}
