import { useEffect, useMemo, useState } from 'react'
import * as monaco from 'monaco-editor'
import { DiffLine, groupDiffLines } from '../diffParser'
import { languageForFile } from '../utils/language'
import DiffLineRow from './DiffLineRow'

// Reconstructs the old/new file text and colorizes it with Monaco's tokenizer (same as the editor); colorize() joins lines with <br/>, so split on that to re-align with each diff line.
function useDiffHighlighting(lines: DiffLine[], fileName?: string): { old: string[] | null; new: string[] | null } {
  const [oldHtml, setOldHtml] = useState<string[] | null>(null)
  const [newHtml, setNewHtml] = useState<string[] | null>(null)

  useEffect(() => {
    if (!fileName) {
      setOldHtml(null)
      setNewHtml(null)
      return
    }
    const language = languageForFile(fileName)
    const oldContent = lines
      .filter((l) => l.type !== 'add' && l.type !== 'hunk')
      .map((l) => l.content)
      .join('\n')
    const newContent = lines
      .filter((l) => l.type !== 'remove' && l.type !== 'hunk')
      .map((l) => l.content)
      .join('\n')

    let cancelled = false
    Promise.all([
      monaco.editor.colorize(oldContent, language, { tabSize: 2 }),
      monaco.editor.colorize(newContent, language, { tabSize: 2 })
    ])
      .then(([oldResult, newResult]) => {
        if (cancelled) return
        setOldHtml(oldResult.split('<br/>'))
        setNewHtml(newResult.split('<br/>'))
      })
      .catch(() => {
        if (!cancelled) {
          setOldHtml(null)
          setNewHtml(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [lines, fileName])

  return { old: oldHtml, new: newHtml }
}

export default function DiffLinesView({
  lines,
  context = 3,
  fileName
}: {
  lines: DiffLine[]
  context?: number
  fileName?: string
}): JSX.Element {
  const items = useMemo(() => groupDiffLines(lines, context), [lines, context])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const highlighted = useDiffHighlighting(lines, fileName)

  function htmlFor(line: DiffLine): string | undefined {
    if (line.type === 'remove') return line.oldLine ? highlighted.old?.[line.oldLine - 1] : undefined
    return line.newLine ? highlighted.new?.[line.newLine - 1] : undefined
  }

  return (
    <div style={{ fontFamily: 'Menlo, Consolas, monospace', fontSize: 12 }}>
      {items.map((item, i) => {
        if (item.kind === 'line') return <DiffLineRow key={i} line={item.line} html={htmlFor(item.line)} />
        const isOpen = expanded.has(i)
        if (isOpen) {
          return (
            <div key={i}>
              {item.lines.map((l, j) => (
                <DiffLineRow key={j} line={l} html={htmlFor(l)} />
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
