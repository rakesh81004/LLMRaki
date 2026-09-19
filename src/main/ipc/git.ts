import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache'])

export interface GitFileChange {
  path: string
  index: string
  workingTree: string
  staged: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
  parents: string[]
  refs: string[]
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 })
  return stdout
}

function parseStatus(raw: string): Omit<GitStatus, 'isRepo'> {
  const lines = raw.split('\n').filter(Boolean)
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const staged: GitFileChange[] = []
  const unstaged: GitFileChange[] = []
  const untracked: GitFileChange[] = []

  for (const line of lines) {
    if (line.startsWith('##')) {
      const info = line.slice(2).trim()
      const branchMatch = info.match(/^([^.\s]+)/)
      if (branchMatch) branch = branchMatch[1]
      const aheadMatch = info.match(/ahead (\d+)/)
      const behindMatch = info.match(/behind (\d+)/)
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10)
      if (behindMatch) behind = parseInt(behindMatch[1], 10)
      continue
    }
    const index = line[0]
    const workingTree = line[1]
    const filePath = line.slice(3).split(' -> ').pop() ?? line.slice(3)

    if (index === '?' && workingTree === '?') {
      untracked.push({ path: filePath, index, workingTree, staged: false })
      continue
    }
    if (index !== ' ' && index !== '?') {
      staged.push({ path: filePath, index, workingTree, staged: true })
    }
    if (workingTree !== ' ' && workingTree !== '?') {
      unstaged.push({ path: filePath, index, workingTree, staged: false })
    }
  }

  return { branch, ahead, behind, staged, unstaged, untracked }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await runGit(dir, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

// git rev-parse only searches upward, never into subfolders, so a nested repo (e.g. .git one level down in an opened outer folder) needs an explicit shallow scan to be found.
async function findGitRoot(root: string): Promise<string | null> {
  if (await isGitRepo(root)) return root

  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
      const sub = path.join(root, entry.name)
      if (await isGitRepo(sub)) return sub
    }
  } catch {
    return null
  }
  return null
}

export function registerGitHandlers(): void {
  ipcMain.handle('git:findRoot', async (_e, root: string): Promise<string | null> => {
    return findGitRoot(root)
  })

  ipcMain.handle('git:status', async (_e, root: string): Promise<GitStatus> => {
    try {
      await runGit(root, ['rev-parse', '--is-inside-work-tree'])
    } catch {
      return { isRepo: false, branch: null, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] }
    }
    const raw = await runGit(root, ['status', '--porcelain', '-b'])
    return { isRepo: true, ...parseStatus(raw) }
  })

  ipcMain.handle('git:diff', async (_e, root: string, filePath: string, staged: boolean) => {
    const args = staged
      ? ['diff', '--unified=100000', '--cached', '--', filePath]
      : ['diff', '--unified=100000', '--', filePath]
    return runGit(root, args)
  })

  ipcMain.handle('git:stage', async (_e, root: string, filePath: string) => {
    await runGit(root, ['add', '--', filePath])
  })

  ipcMain.handle('git:unstage', async (_e, root: string, filePath: string) => {
    await runGit(root, ['reset', '--', filePath])
  })

  ipcMain.handle('git:discard', async (_e, root: string, filePath: string) => {
    await runGit(root, ['checkout', '--', filePath])
  })

  ipcMain.handle('git:stageAll', async (_e, root: string) => {
    await runGit(root, ['add', '-A'])
  })

  ipcMain.handle('git:commit', async (_e, root: string, message: string) => {
    await runGit(root, ['commit', '-m', message])
  })

  ipcMain.handle('git:push', async (_e, root: string) => {
    await runGit(root, ['push'])
  })

  ipcMain.handle('git:pull', async (_e, root: string) => {
    await runGit(root, ['pull'])
  })

  ipcMain.handle('git:show', async (_e, root: string, hash: string) => {
    return runGit(root, ['show', '--unified=100000', hash])
  })

  ipcMain.handle('git:log', async (_e, root: string, limit = 150): Promise<GitCommit[]> => {
    const FIELD_SEP = '\x1f'
    try {
      const raw = await runGit(root, [
        'log',
        `--pretty=format:%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%ar${FIELD_SEP}%s${FIELD_SEP}%P${FIELD_SEP}%D`,
        `-n`,
        String(limit)
      ])
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, shortHash, author, date, message, parents, refs] = line.split(FIELD_SEP)
          return {
            hash,
            shortHash,
            author,
            date,
            message,
            parents: parents ? parents.split(' ').filter(Boolean) : [],
            refs: refs
              ? refs
                  .split(',')
                  .map((r) => r.trim())
                  .filter(Boolean)
              : []
          }
        })
    } catch {
      return []
    }
  })
}
