import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactElement, ReactNode } from 'react'
import CodeBlock from './CodeBlock'
import FileTypeBadge from './FileTypeBadge'

interface Props {
  content: string
  rootFolder?: string | null
  onOpenFile?: (path: string, line?: number) => void
}

const FILE_REF_REGEX = /^([\w@][\w\-./]*\.[a-zA-Z][a-zA-Z0-9]{0,9})(?::(\d+))?$/

function joinPath(root: string, rel: string): string {
  const cleanRoot = root.replace(/\/+$/, '')
  const cleanRel = rel.replace(/^\/+/, '')
  return `${cleanRoot}/${cleanRel}`
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}

export default function Markdown({ content, rootFolder, onOpenFile }: Props): JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props
            const text = String(children).trim()
            const match = !className && rootFolder && onOpenFile ? text.match(FILE_REF_REGEX) : null

            if (match) {
              const [, relPath, lineStr] = match
              const line = lineStr ? parseInt(lineStr, 10) : undefined
              const fileName = relPath.split(/[/\\]/).pop() ?? relPath
              return (
                <button
                  className="file-ref-link"
                  title={`Open ${relPath}${line ? `:${line}` : ''}`}
                  onClick={() => onOpenFile!(joinPath(rootFolder!, relPath), line)}
                >
                  <FileTypeBadge fileName={fileName} />
                  <span className="file-ref-text">{text}</span>
                </button>
              )
            }

            return (
              <code className={className} {...rest}>
                {children as ReactNode}
              </code>
            )
          },
          pre(props) {
            const child = props.children as ReactElement<{
              className?: string
              children?: ReactNode
            }> | null
            const className = child?.props?.className ?? ''
            const rawText = extractText(child?.props?.children).replace(/\n$/, '')
            let lines = rawText.split('\n')

            // A `LOC_START:N` marker as the first line means the excerpt came from a real file at line N — strip it and number the gutter from there instead of starting at 1.
            let startLine = 1
            const locMatch = lines[0]?.trim().match(/^LOC_START:(\d+)$/)
            if (locMatch) {
              startLine = parseInt(locMatch[1], 10)
              lines = lines.slice(1).map((line) => line.replace(/^\d+:\s?/, ''))
            }

            const fenceLang = className.replace('language-', '')

            return (
              <pre>
                <CodeBlock code={lines.join('\n')} fenceLang={fenceLang} startLine={startLine} />
              </pre>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
