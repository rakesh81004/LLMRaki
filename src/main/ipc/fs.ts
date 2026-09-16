import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { addRecentFolder, removeRecentFolder } from './settings'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

const IGNORED = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'out', 'build'])

async function readDir(dirPath: string): Promise<FileEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((e) => !IGNORED.has(e.name))
    .map((e) => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      isDirectory: e.isDirectory()
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function registerFsHandlers(): void {
  ipcMain.handle('fs:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const root = result.filePaths[0]
    const entries = await readDir(root)
    await addRecentFolder(root)
    return { root, entries }
  })

  ipcMain.handle('fs:openFolderAtPath', async (_e, folderPath: string) => {
    try {
      const entries = await readDir(folderPath)
      await addRecentFolder(folderPath)
      return { root: folderPath, entries }
    } catch {
      await removeRecentFolder(folderPath)
      return null
    }
  })

  ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
    return readDir(dirPath)
  })

  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    return fs.readFile(filePath, 'utf-8')
  })

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('fs:createFile', async (_e, dirPath: string, name: string) => {
    const filePath = path.join(dirPath, name)
    await fs.writeFile(filePath, '', { flag: 'wx' })
    return filePath
  })

  ipcMain.handle('fs:createFolder', async (_e, dirPath: string, name: string) => {
    const folderPath = path.join(dirPath, name)
    await fs.mkdir(folderPath)
    return folderPath
  })

  ipcMain.handle('fs:rename', async (_e, oldPath: string, newPath: string) => {
    await fs.rename(oldPath, newPath)
  })

  ipcMain.handle('fs:showSaveDialog', async (_e, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('fs:delete', async (_e, targetPath: string, isDirectory: boolean) => {
    if (isDirectory) {
      await fs.rm(targetPath, { recursive: true, force: true })
    } else {
      await fs.unlink(targetPath)
    }
  })

  ipcMain.handle('fs:revealInFinder', async (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  ipcMain.handle('fs:openInDefaultApp', async (_e, targetPath: string) => {
    await shell.openPath(targetPath)
  })

  // Used for copy+paste (as opposed to cut+paste, which reuses fs:rename to move).
  // Auto-renames to "name (copy)" / "name (copy 2)" etc. when the target already exists.
  ipcMain.handle('fs:copy', async (_e, sourcePath: string, destDir: string) => {
    const base = path.basename(sourcePath)
    const ext = path.extname(base)
    const stem = ext ? base.slice(0, -ext.length) : base

    async function exists(p: string): Promise<boolean> {
      return fs
        .access(p)
        .then(() => true)
        .catch(() => false)
    }

    let candidate = path.join(destDir, base)
    let n = 0
    while (await exists(candidate)) {
      n += 1
      const label = n === 1 ? 'copy' : `copy ${n}`
      candidate = path.join(destDir, `${stem} (${label})${ext}`)
    }

    await fs.cp(sourcePath, candidate, { recursive: true })
    return candidate
  })
}
