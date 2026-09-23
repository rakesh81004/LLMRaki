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
const FILE_REF_INLINE_REGEX = /`([\w@][\w\-./]*\.[a-zA-Z][a-zA-Z0-9]{0,9})(?::(\d+))?`/g
const FENCE_REGEX = /```[a-zA-Z0-9_+-]*\n[\s\S]*?```/g

function joinPath(root: string, rel: string): string {
  const cleanRoot = root.replace(/\/+$/, '')
  const cleanRel = rel.replace(/^\/+/, '')
  return `${cleanRoot}/${cleanRel}`
}

// react-markdown renders each fenced code block with no awareness of the file it's excerpted
// from — that association only exists as a separate inline `path:line` citation somewhere in the
// surrounding prose. Scanning the raw markdown up front (in document order, alongside where each
// fence actually falls) lets the Nth fenced block look up which citation precedes it, so clicking
// the code itself can jump to the same place its citation badge does.
function computeCodeBlockFileRefs(content: string): ({ path: string; line?: number } | null)[] {
  const refs: ({ path: string; line?: number } | null)[] = []
  let lastFenceEnd = 0
  let carriedRef: { path: string; line?: number } | null = null
  FENCE_REGEX.lastIndex = 0
  let fenceMatch: RegExpExecArray | null
  while ((fenceMatch = FENCE_REGEX.exec(content)) !== null) {
    const precedingText = content.slice(lastFenceEnd, fenceMatch.index)
    FILE_REF_INLINE_REGEX.lastIndex = 0
    let refMatch: RegExpExecArray | null
    while ((refMatch = FILE_REF_INLINE_REGEX.exec(precedingText)) !== null) {
      carriedRef = { path: refMatch[1], line: refMatch[2] ? parseInt(refMatch[2], 10) : undefined }
    }
    refs.push(carriedRef)
    lastFenceEnd = fenceMatch.index + fenceMatch[0].length
  }
  return refs
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
  const codeBlockFileRefs = computeCodeBlockFileRefs(content)
  let fenceIndex = 0

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
            let fromRealFile = false
            const locMatch = lines[0]?.trim().match(/^LOC_START:(\d+)$/)
            if (locMatch) {
              startLine = parseInt(locMatch[1], 10)
              fromRealFile = true
              lines = lines.slice(1).map((line) => line.replace(/^\d+:\s?/, ''))
            }

            const fenceLang = className.replace('language-', '')

            // Only excerpts carrying a real LOC_START marker get a click-to-open — an example/
            // hypothetical snippet has no marker, so a stale nearby file ref is never applied to it.
            const fileRef = fromRealFile ? codeBlockFileRefs[fenceIndex] : null
            fenceIndex += 1

            return (
              <pre>
                <CodeBlock
                  code={lines.join('\n')}
                  fenceLang={fenceLang}
                  startLine={startLine}
                  filePath={rootFolder && onOpenFile && fileRef ? joinPath(rootFolder, fileRef.path) : null}
                  onOpenFile={onOpenFile}
                />
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
