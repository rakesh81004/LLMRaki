import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'

// Catches file changes from ANY source — the in-app AI, an external editor, git operations
// run in a separate terminal, even another AI agent working on the same repo — not just the
// app's own write_file/terminal tools. Node's recursive fs.watch is macOS/Windows-only, which
// matches this app's macOS-only scope, so no extra dependency (chokidar) is needed.
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache'])
const DEBOUNCE_MS = 400

let activeWatcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let watchedRoot: string | null = null

function isIgnored(filename: string | null): boolean {
  if (!filename) return false
  return filename.replace(/\\/g, '/').split('/').some((seg) => IGNORED_SEGMENTS.has(seg))
}

function stopWatching(): void {
  activeWatcher?.close()
  activeWatcher = null
  watchedRoot = null
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

export function registerFsWatchHandlers(): void {
  ipcMain.handle('fs:watchRoot', (_e, root: string | null) => {
    stopWatching()
    if (!root) return
    watchedRoot = root
    try {
      activeWatcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (isIgnored(filename)) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          if (!watchedRoot) return
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('fs:changed', watchedRoot)
          }
        }, DEBOUNCE_MS)
      })
    } catch {
      // Recursive watch unsupported for this path — AI-driven edits still refresh explicitly
      // via their own onFileChanged/onWorkspaceChanged signals, so this is a soft degradation.
    }
  })

  ipcMain.handle('fs:unwatchRoot', () => {
    stopWatching()
  })
}
