interface FuzzyMatch {
  indices: number[]
  score: number
}

// Subsequence fuzzy match — every query character must appear in order in text; score rewards early and contiguous matches.
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (!query) return { indices: [], score: 0 }
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const indices: number[] = []
  let cursor = 0
  let score = 0
  let consecutive = 0

  for (let qi = 0; qi < q.length; qi++) {
    const foundAt = t.indexOf(q[qi], cursor)
    if (foundAt === -1) return null
    if (foundAt === cursor) {
      consecutive += 1
      score += consecutive * 3
    } else {
      consecutive = 0
    }
    indices.push(foundAt)
    cursor = foundAt + 1
  }

  score += Math.max(0, 15 - indices[0])
  return { indices, score }
}
