import type { DiffLine } from './diffParser'

type LineDiffOp =
  | { type: 'equal'; text: string }
  | { type: 'delete'; text: string }
  | { type: 'insert'; text: string }

// Myers O(ND) diff, used to visualize AI-made edits (no git diff available) the same way the git-based viewer looks.
export function diffLines(oldText: string, newText: string): LineDiffOp[] {
  const a = oldText.length > 0 ? oldText.split('\n') : []
  const b = newText.length > 0 ? newText.split('\n') : []
  const n = a.length
  const m = b.length
  const max = n + m

  if (max === 0) return []

  const offset = max
  const v = new Array<number>(2 * max + 1).fill(0)
  const trace: number[][] = []

  let d = 0
  search: for (d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]
      } else {
        x = v[k - 1 + offset] + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + offset] = x
      if (x >= n && y >= m) break search
    }
  }

  const ops: LineDiffOp[] = []
  let x = n
  let y = m
  for (let depth = d; depth > 0; depth--) {
    const vPrev = trace[depth]
    const k = x - y
    const prevK = k === -depth || (k !== depth && vPrev[k - 1 + offset] < vPrev[k + 1 + offset]) ? k + 1 : k - 1
    const prevX = vPrev[prevK + offset]
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', text: a[x - 1] })
      x--
      y--
    }
    if (x === prevX) {
      ops.push({ type: 'insert', text: b[y - 1] })
      y--
    } else {
      ops.push({ type: 'delete', text: a[x - 1] })
      x--
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', text: a[x - 1] })
    x--
    y--
  }

  ops.reverse()
  return ops
}

export function opsToDiffLines(ops: LineDiffOp[]): DiffLine[] {
  let oldNo = 0
  let newNo = 0
  return ops.map((op) => {
    if (op.type === 'equal') {
      oldNo++
      newNo++
      return { type: 'context', content: op.text, oldLine: oldNo, newLine: newNo }
    }
    if (op.type === 'delete') {
      oldNo++
      return { type: 'remove', content: op.text, oldLine: oldNo, newLine: null }
    }
    newNo++
    return { type: 'add', content: op.text, oldLine: null, newLine: newNo }
  })
}

export function diffStats(ops: LineDiffOp[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'insert') added++
    else if (op.type === 'delete') removed++
  }
  return { added, removed }
}
