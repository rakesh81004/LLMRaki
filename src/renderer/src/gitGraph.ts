import type { GitCommit } from './types'

const GRAPH_LANE_COLORS = [
  '#e8833a',
  '#e35d9c',
  '#3fc1b0',
  '#a06cd5',
  '#e0c341',
  '#5b9df9',
  '#e0575b',
  '#7bc96f',
  '#d68cf3',
  '#4fd1c5'
]

interface GraphLaneSeg {
  lane: number
  color: string
}

interface GraphCurve {
  from: number
  to: number
  color: string
}

interface GitGraphRow {
  commit: GitCommit
  lane: number
  color: string
  isMerge: boolean
  isHead: boolean
  topStraight: GraphLaneSeg[]
  topCurvesIn: GraphCurve[]
  bottomStraight: GraphLaneSeg[]
  bottomCurvesOut: GraphCurve[]
  hasTopLine: boolean
  hasBottomLine: boolean
}

interface GitGraphLayout {
  rows: GitGraphRow[]
  maxLanes: number
}

// Lays out a multi-lane commit graph (like `git log --graph`): each lane persists and keeps its color while a line of descent is unresolved; merges fan a lane into new lanes, and converging branches curve back into one.
export function buildGitGraph(commits: GitCommit[]): GitGraphLayout {
  const active: (string | null)[] = []
  const laneColor: (string | null)[] = []
  let colorIdx = 0
  const nextColor = (): string => GRAPH_LANE_COLORS[colorIdx++ % GRAPH_LANE_COLORS.length]

  const rows: GitGraphRow[] = []
  let maxLanes = 0

  for (const commit of commits) {
    const beforeActive = active.slice()

    const matching: number[] = []
    beforeActive.forEach((h, idx) => {
      if (h !== null && h === commit.hash) matching.push(idx)
    })

    let lane: number
    let isNewTip = false
    if (matching.length > 0) {
      lane = matching[0]
    } else {
      isNewTip = true
      const free = active.findIndex((h) => h === null)
      lane = free !== -1 ? free : active.length
      if (lane === active.length) {
        active.push(null)
        laneColor.push(null)
      }
    }
    if (!laneColor[lane]) laneColor[lane] = nextColor()
    const color = laneColor[lane] as string

    const topStraight: GraphLaneSeg[] = []
    const topCurvesIn: GraphCurve[] = []
    beforeActive.forEach((h, idx) => {
      if (h === null || idx === lane) return
      if (matching.includes(idx)) {
        topCurvesIn.push({ from: idx, to: lane, color: laneColor[idx] as string })
      } else {
        topStraight.push({ lane: idx, color: laneColor[idx] as string })
      }
    })

    matching.forEach((idx) => {
      if (idx !== lane) {
        active[idx] = null
        laneColor[idx] = null
      }
    })

    const bottomCurvesOut: GraphCurve[] = []
    const parents = commit.parents

    if (parents.length === 0) {
      active[lane] = null
      laneColor[lane] = null
    } else {
      active[lane] = parents[0]
      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p]
        const free = active.findIndex((h) => h === null)
        const targetLane = free !== -1 ? free : active.length
        if (targetLane === active.length) {
          active.push(null)
          laneColor.push(null)
        }
        laneColor[targetLane] = nextColor()
        active[targetLane] = parentHash
        bottomCurvesOut.push({ from: lane, to: targetLane, color: laneColor[targetLane] as string })
      }
    }

    const bottomStraight: GraphLaneSeg[] = []
    active.forEach((h, idx) => {
      if (h === null || idx === lane) return
      if (bottomCurvesOut.some((c) => c.to === idx)) return
      bottomStraight.push({ lane: idx, color: laneColor[idx] as string })
    })

    maxLanes = Math.max(maxLanes, active.length)

    rows.push({
      commit,
      lane,
      color,
      isMerge: parents.length > 1,
      isHead: commit.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD ->')),
      topStraight,
      topCurvesIn,
      bottomStraight,
      bottomCurvesOut,
      hasTopLine: !isNewTip,
      hasBottomLine: parents.length > 0
    })
  }

  return { rows, maxLanes: Math.max(maxLanes, 1) }
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

interface ParsedRef {
  kind: RefKind
  label: string
}

export function parseRefs(refs: string[]): ParsedRef[] {
  return refs.map((r) => {
    if (r.startsWith('HEAD -> ')) return { kind: 'head', label: r.slice('HEAD -> '.length) }
    if (r === 'HEAD') return { kind: 'head', label: 'HEAD' }
    if (r.startsWith('tag: ')) return { kind: 'tag', label: r.slice('tag: '.length) }
    if (r.includes('/')) return { kind: 'remote', label: r }
    return { kind: 'local', label: r }
  })
}

export const REF_KIND_COLORS: Record<RefKind, string> = {
  head: '#5b9df9',
  local: '#7bc96f',
  remote: '#e8833a',
  tag: '#e0c341'
}
