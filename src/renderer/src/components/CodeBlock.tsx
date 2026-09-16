import { useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { EXT_TO_LANGUAGE } from '../utils/language'

interface Props {
  code: string
  fenceLang: string
  startLine: number
}

function toMonacoLanguage(fenceLang: string): string {
  const key = fenceLang.trim().toLowerCase()
  if (!key) return 'plaintext'
  return EXT_TO_LANGUAGE[key] ?? key
}

// Reuses Monaco's own tokenizer/theme (the same one the code editor uses) so
// code shown in AI chat responses is colored exactly like viewing the file.
export default function CodeBlock({ code, fenceLang, startLine }: Props): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const language = toMonacoLanguage(fenceLang)
  const lines = code.split('\n')

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
    <div className="code-block">
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
