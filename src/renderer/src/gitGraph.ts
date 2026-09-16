import type { GitCommit } from './types'

// A palette cycled through every time a brand-new branch line starts (not tied
// to a fixed lane column), so colors stay distinct the way GitLens/VS Code's
// graph looks, instead of repeating every N lanes.
export const GRAPH_LANE_COLORS = [
  '#e8833a', // orange
  '#e35d9c', // pink
  '#3fc1b0', // teal
  '#a06cd5', // purple
  '#e0c341', // gold
  '#5b9df9', // blue
  '#e0575b', // red
  '#7bc96f', // green
  '#d68cf3', // lilac
  '#4fd1c5' // cyan
]

export interface GraphLaneSeg {
  lane: number
  color: string
}

export interface GraphCurve {
  from: number
  to: number
  color: string
}

export interface GitGraphRow {
  commit: GitCommit
  lane: number
  color: string
  isMerge: boolean
  isHead: boolean
  /** Straight lines for unrelated branches passing above the dot's row-half. */
  topStraight: GraphLaneSeg[]
  /** Curves for other branches merging into this commit from above. */
  topCurvesIn: GraphCurve[]
  /** Straight lines for unrelated branches passing below the dot's row-half. */
  bottomStraight: GraphLaneSeg[]
  /** Curves fanning out to other parents (merge commits) below. */
  bottomCurvesOut: GraphCurve[]
  hasTopLine: boolean
  hasBottomLine: boolean
}

export interface GitGraphLayout {
  rows: GitGraphRow[]
  maxLanes: number
}

/**
 * Lays out a colorful multi-lane commit graph (like `git log --graph` /
 * GitLens) from a flat, newest-first commit list. Each lane is a vertical
 * "track" that persists (and keeps its color) for as long as a line of
 * descent is unresolved; merges fan a lane out into new lanes, and branch
 * points converge separate lanes back into one with a curve.
 */
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

    // Non-primary lanes that also pointed at this commit have converged here;
    // free them so their columns can be reused (with a fresh color) later.
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

export interface ParsedRef {
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
