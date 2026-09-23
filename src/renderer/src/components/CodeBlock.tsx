import { useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { EXT_TO_LANGUAGE } from '../utils/language'

interface Props {
  code: string
  fenceLang: string
  startLine: number
  filePath?: string | null
  onOpenFile?: (path: string, line?: number) => void
}

function toMonacoLanguage(fenceLang: string): string {
  const key = fenceLang.trim().toLowerCase()
  if (!key) return 'plaintext'
  return EXT_TO_LANGUAGE[key] ?? key
}

// Reuses Monaco's own tokenizer/theme so code in AI chat responses is colored exactly like viewing the file.
export default function CodeBlock({ code, fenceLang, startLine, filePath, onOpenFile }: Props): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const language = toMonacoLanguage(fenceLang)
  const lines = code.split('\n')
  const clickable = Boolean(filePath && onOpenFile)

  useEffect(() => {
    let cancelled = false
    monaco.editor
      .colorize(code, language, { tabSize: 2 })
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  return (
    <div
      className={clickable ? 'code-block code-block-clickable' : 'code-block'}
      title={clickable ? `Open ${filePath} at line ${startLine}` : undefined}
      onClick={clickable ? () => onOpenFile!(filePath!, startLine) : undefined}
    >
      <div className="code-block-gutter" aria-hidden="true">
        {lines.map((_, i) => (
          <span key={i}>{startLine + i}</span>
        ))}
      </div>
      {html ? (
        // eslint-disable-next-line react/no-danger
        <code className="monaco-colorized" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{code}</code>
      )}
    </div>
  )
}
