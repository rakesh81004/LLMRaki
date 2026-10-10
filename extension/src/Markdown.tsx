import { useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}

function CodeBlock({ children }: { children: ReactNode }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const child = children as ReactElement<{ className?: string; children?: ReactNode }> | null
  const lang = (child?.props?.className ?? '').replace('language-', '')
  const code = extractText(child?.props?.children).replace(/\n$/, '')

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{lang || 'code'}</span>
        <button className="link-button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

export default function Markdown({ content }: { content: string }): JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
