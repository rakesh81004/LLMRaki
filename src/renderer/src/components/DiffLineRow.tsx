import type { DiffLine } from '../diffParser'

export default function DiffLineRow({ line, html }: { line: DiffLine; html?: string }): JSX.Element {
  const bg =
    line.type === 'add'
      ? 'rgba(46, 160, 67, 0.18)'
      : line.type === 'remove'
        ? 'rgba(248, 81, 73, 0.18)'
        : 'transparent'
  const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ''
  const markerColor =
    line.type === 'add' ? 'var(--success)' : line.type === 'remove' ? 'var(--danger)' : 'var(--text-muted)'
  return (
    <div style={{ display: 'flex', background: bg }}>
      <span
        style={{
          width: 42,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 6,
          color: 'var(--text-muted)',
          opacity: 0.7,
          userSelect: 'none'
        }}
      >
        {line.oldLine ?? ''}
      </span>
      <span
        style={{
          width: 42,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 8,
          color: 'var(--text-muted)',
          opacity: 0.7,
          userSelect: 'none'
        }}
      >
        {line.newLine ?? ''}
      </span>
      <span style={{ width: 14, flexShrink: 0, textAlign: 'center', color: markerColor, userSelect: 'none' }}>
        {marker}
      </span>
      {html !== undefined ? (
        // eslint-disable-next-line react/no-danger
        <span
          className="monaco-colorized"
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1 }}>{line.content}</span>
      )}
    </div>
  )
}
