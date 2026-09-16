import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache'])
const MAX_FILE_LIST = 5000
const MAX_SEARCH_RESULTS = 500
export const MAX_FILE_SIZE = 2 * 1024 * 1024 // skip binaries/huge files

export interface SearchMatch {
  file: string
  line: number
  preview: string
  matchStart: number
  matchLength: number
}

export interface TextSearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
}

export interface RelevantFile {
  path: string
  score: number
  content: string
  truncated: boolean
}

export interface ScoredFile {
  path: string
  score: number
  content: string
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'webp', 'pdf', 'zip', 'gz', 'tar',
  'lock', 'woff', 'woff2', 'ttf', 'eot', 'mp4', 'mp3', 'mov', 'avi', 'wasm',
  'node', 'exe', 'dll', 'dylib', 'so', 'bin', 'db', 'sqlite'
])

const MAX_RELEVANT_FILES = 6
const MAX_CONTENT_PER_FILE = 6000
const CONTENT_SCORE_CAP_PER_KEYWORD = 5

const STOPWORDS = new Set([
  'the', 'is', 'are', 'how', 'what', 'when', 'where', 'why', 'which', 'who',
  'with', 'from', 'this', 'that', 'does', 'doing', 'done', 'into', 'onto',
  'for', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'a', 'an', 'it', 'its',
  'be', 'was', 'were', 'has', 'have', 'had', 'can', 'could', 'should',
  'would', 'will', 'shall', 'explain', 'about', 'show', 'tell', 'please'
])

export function extractKeywords(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  return Array.from(new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))).slice(0, 12)
}

export async function walk(dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    if (IGNORED_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out, limit)
    } else {
      out.push(full)
    }
  }
}

// Shared scoring engine: ranks files in `root` by how well their path/content
// match `query`'s keywords. Used both for one-shot context injection
// (relevantFiles) and for the agent's search_files tool (more, shorter results).
export async function findMatchingFiles(
  root: string,
  query: string,
  maxResults: number
): Promise<ScoredFile[]> {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) return []

  const files: string[] = []
  await walk(root, files, MAX_FILE_LIST)

  const candidates: ScoredFile[] = []

  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase()
    if (BINARY_EXTENSIONS.has(ext)) continue

    const lowerPath = file.toLowerCase()
    let pathScore = 0
    for (const kw of keywords) {
      if (lowerPath.includes(kw)) pathScore += 5
    }

    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      continue
    }
    if (stat.size > MAX_FILE_SIZE) {
      if (pathScore > 0) candidates.push({ path: file, score: pathScore, content: '' })
      continue
    }

    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }

    const lowerContent = content.toLowerCase()
    let contentScore = 0
    for (const kw of keywords) {
      const occurrences = lowerContent.split(kw).length - 1
      contentScore += Math.min(occurrences, CONTENT_SCORE_CAP_PER_KEYWORD)
    }

    const score = pathScore + contentScore
    if (score > 0) candidates.push({ path: file, score, content })
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, maxResults)
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:listFiles', async (_e, root: string): Promise<string[]> => {
    const files: string[] = []
    await walk(root, files, MAX_FILE_LIST)
    return files
  })

  ipcMain.handle(
    'search:text',
    async (_e, root: string, query: string, options: TextSearchOptions = {}): Promise<SearchMatch[]> => {
      if (!query.trim()) return []

      let matcher: RegExp
      try {
        if (options.useRegex) {
          matcher = new RegExp(query, options.caseSensitive ? 'g' : 'gi')
        } else {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped
          matcher = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi')
        }
      } catch {
        return [] // invalid regex — treat as no results rather than erroring
      }

      const files: string[] = []
      await walk(root, files, MAX_FILE_LIST)
      const results: SearchMatch[] = []

      for (const file of files) {
        if (results.length >= MAX_SEARCH_RESULTS) break
        try {
          const stat = await fs.stat(file)
          if (stat.size > MAX_FILE_SIZE) continue
          const content = await fs.readFile(file, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            matcher.lastIndex = 0
            const line = lines[i]
            const match = matcher.exec(line)
            if (match) {
              const leadingWhitespace = line.length - line.trimStart().length
              const preview = line.trim().slice(0, 200)
              const matchStart = Math.max(0, Math.min(match.index - leadingWhitespace, preview.length))
              const matchLength = Math.max(0, Math.min(match[0].length, preview.length - matchStart))
              results.push({ file, line: i + 1, preview, matchStart, matchLength })
              if (results.length >= MAX_SEARCH_RESULTS) break
            }
          }
        } catch {
          // skip unreadable/binary files
        }
      }
      return results
    }
  )

  ipcMain.handle(
    'search:relevantFiles',
    async (_e, root: string, query: string): Promise<RelevantFile[]> => {
      const top = await findMatchingFiles(root, query, MAX_RELEVANT_FILES)
      return top.map((c) => {
        const truncated = c.content.length > MAX_CONTENT_PER_FILE
        return {
          path: c.path,
          score: c.score,
          content: truncated ? c.content.slice(0, MAX_CONTENT_PER_FILE) : c.content,
          truncated
        }
      })
    }
  )
}
