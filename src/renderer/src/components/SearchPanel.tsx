import { useState } from 'react'
import { SearchMatch } from '../types'
import { ChevronIcon } from './Icons'
import FileTypeBadge from './FileTypeBadge'

interface Props {
  rootFolder: string | null
  onOpenMatch: (filePath: string, line: number) => void
}

export default function SearchPanel({ rootFolder, onOpenMatch }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  async function runSearch(): Promise<void> {
    if (!rootFolder || !query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const matches = await window.api.search.text(rootFolder, query.trim(), {
        caseSensitive,
        wholeWord,
        useRegex
      })
      setResults(matches)
      setCollapsed(new Set())
    } finally {
      setLoading(false)
    }
  }

  function relativePath(filePath: string): string {
    if (!rootFolder) return filePath
    return filePath.startsWith(rootFolder) ? filePath.slice(rootFolder.length + 1) : filePath
  }

  function toggleCollapsed(file: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  function toggleButtonStyle(active: boolean): React.CSSProperties {
    return {
      background: active ? 'var(--accent)' : 'transparent',
      border: '1px solid ' + (active ? 'var(--accent-bright)' : 'var(--border)'),
      borderRadius: 3,
      color: active ? 'white' : 'var(--text-muted)',
      fontSize: 10,
      fontWeight: 700,
      width: 20,
      height: 20,
      lineHeight: '18px',
      padding: 0
    }
  }

  const grouped = results.reduce<Record<string, SearchMatch[]>>((acc, m) => {
    acc[m.file] = acc[m.file] || []
    acc[m.file].push(m)
    return acc
  }, {})
  const fileCount = Object.keys(grouped).length

  return (
    <>
      <div className="sidebar-header">
        <span>Search</span>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ position: 'relative' }}>
          <input
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 68px 6px 8px',
              boxSizing: 'border-box'
            }}
            placeholder="Search across files…"
            value={query}
            disabled={!rootFolder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <div style={{ position: 'absolute', right: 4, top: 3, display: 'flex', gap: 2 }}>
            <button
              title="Match Case"
              style={toggleButtonStyle(caseSensitive)}
              onClick={() => setCaseSensitive((v) => !v)}
            >
              Aa
            </button>
            <button
              title="Match Whole Word"
              style={toggleButtonStyle(wholeWord)}
              onClick={() => setWholeWord((v) => !v)}
            >
              ab
            </button>
            <button
              title="Use Regular Expression"
              style={toggleButtonStyle(useRegex)}
              onClick={() => setUseRegex((v) => !v)}
            >
              .*
            </button>
          </div>
        </div>
        {searched && !loading && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {results.length} result{results.length === 1 ? '' : 's'} in {fileCount} file
            {fileCount === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <div className="sidebar-content">
        {!rootFolder && <div className="empty-state">Open a folder to search across files.</div>}
        {rootFolder && !searched && (
          <div className="empty-state">Type a query and press Enter to search the workspace.</div>
        )}
        {loading && <div className="empty-state">Searching…</div>}
        {!loading && searched && results.length === 0 && (
          <div className="empty-state">No results found.</div>
        )}
        {!loading &&
          Object.entries(grouped).map(([file, matches]) => {
            const isCollapsed = collapsed.has(file)
            const fileName = file.split(/[/\\]/).pop() ?? file
            const dir = relativePath(file).split(/[/\\]/).slice(0, -1).join('/')
            return (
              <div key={file}>
                <div className="tree-item" onClick={() => toggleCollapsed(file)}>
                  <span className={`chevron ${!isCollapsed ? 'expanded' : ''}`}>
                    <ChevronIcon />
                  </span>
                  <span className="file-icon">
                    <FileTypeBadge fileName={fileName} />
                  </span>
                  <span style={{ fontWeight: 600 }}>{fileName}</span>
                  {dir && (
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        marginLeft: 6,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {dir}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <span
                    style={{
                      background: 'var(--bg-active)',
                      color: 'var(--text-muted)',
                      borderRadius: 8,
                      fontSize: 10,
                      minWidth: 16,
                      textAlign: 'center',
                      padding: '1px 5px'
                    }}
                  >
                    {matches.length}
                  </span>
                </div>
                {!isCollapsed &&
                  matches.map((m, i) => (
                    <div
                      key={i}
                      className="tree-item"
                      style={{ paddingLeft: 34 }}
                      onClick={() => onOpenMatch(m.file, m.line)}
                    >
                      <span style={{ color: 'var(--text-muted)', marginRight: 6, flexShrink: 0 }}>
                        {m.line}:
                      </span>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {m.preview.slice(0, m.matchStart)}
                        <mark className="search-match-highlight">
                          {m.preview.slice(m.matchStart, m.matchStart + m.matchLength)}
                        </mark>
                        {m.preview.slice(m.matchStart + m.matchLength)}
                      </span>
                    </div>
                  ))}
              </div>
            )
          })}
      </div>
    </>
  )
}
