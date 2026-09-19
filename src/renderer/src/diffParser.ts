type DiffLineType = 'add' | 'remove' | 'context' | 'hunk'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLine: number | null
  newLine: number | null
}

export interface FileDiff {
  path: string
  oldPath: string | null
  isNew: boolean
  isDeleted: boolean
  isRenamed: boolean
  added: number
  removed: number
  lines: DiffLine[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

// Paths can contain spaces, so match via the a/ b/ markers rather than splitting on whitespace.
function pathFromDiffGitLine(line: string): { a: string; b: string } | null {
  const match = line.match(/^diff --git a\/(.*) b\/(.*)$/)
  if (!match) return null
  return { a: match[1], b: match[2] }
}

export function parseUnifiedDiff(raw: string): FileDiff[] {
  const lines = raw.split('\n')
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  let oldLineNo = 0
  let newLineNo = 0

  for (const line of lines) {
    const gitHeader = pathFromDiffGitLine(line)
    if (gitHeader) {
      current = {
        path: gitHeader.b,
        oldPath: gitHeader.a !== gitHeader.b ? gitHeader.a : null,
        isNew: false,
        isDeleted: false,
        isRenamed: gitHeader.a !== gitHeader.b,
        added: 0,
        removed: 0,
        lines: []
      }
      files.push(current)
      continue
    }
    if (!current) continue

    if (line.startsWith('new file mode')) {
      current.isNew = true
      continue
    }
    if (line.startsWith('deleted file mode')) {
      current.isDeleted = true
      continue
    }
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue
    }

    const hunkMatch = line.match(HUNK_HEADER)
    if (hunkMatch) {
      oldLineNo = parseInt(hunkMatch[1], 10)
      newLineNo = parseInt(hunkMatch[2], 10)
      current.lines.push({ type: 'hunk', content: line, oldLine: null, newLine: null })
      continue
    }

    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLineNo })
      current.added++
      newLineNo++
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'remove', content: line.slice(1), oldLine: oldLineNo, newLine: null })
      current.removed++
      oldLineNo++
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ type: 'context', content: line.slice(1), oldLine: oldLineNo, newLine: newLineNo })
      oldLineNo++
      newLineNo++
    }
  }

  return files
}

type DiffRenderItem =
  | { kind: 'line'; line: DiffLine }
  | { kind: 'collapsed'; lines: DiffLine[] }

export function groupDiffLines(lines: DiffLine[], context = 3): DiffRenderItem[] {
  const visible = lines.filter((l) => l.type !== 'hunk')
  const items: DiffRenderItem[] = []
  let i = 0

  while (i < visible.length) {
    const line = visible[i]
    if (line.type !== 'context') {
      items.push({ kind: 'line', line })
      i++
      continue
    }

    let j = i
    while (j < visible.length && visible[j].type === 'context') j++
    const run = visible.slice(i, j)
    const isFirstRun = i === 0
    const isLastRun = j === visible.length

    const leadCount = isFirstRun ? 0 : Math.min(context, run.length)
    const trailCount = isLastRun ? 0 : Math.min(context, run.length - leadCount)
    const middle = run.slice(leadCount, run.length - trailCount)

    run.slice(0, leadCount).forEach((l) => items.push({ kind: 'line', line: l }))
    if (middle.length > 0) items.push({ kind: 'collapsed', lines: middle })
    run.slice(run.length - trailCount).forEach((l) => items.push({ kind: 'line', line: l }))

    i = j
  }

  return items
}
