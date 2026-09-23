import { ipcMain, app, BrowserWindow } from 'electron'
import { createWindow } from '../window'

// Backs the custom in-page menu bar's items that would otherwise be native Electron Menu
// "roles" (Undo, Redo, Cut, Copy, Paste, Select All, Toggle Dev Tools, Toggle Full Screen, Exit)
// — needed only on Windows/Linux, where the native application menu is hidden in favor of a
// menu bar drawn as part of the window's own content (see MenuBar.tsx and window.ts).
export function registerWindowControlHandlers(): void {
  ipcMain.handle('window:performRole', (event, role: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    switch (role) {
      case 'undo':
        win.webContents.undo()
        break
      case 'redo':
        win.webContents.redo()
        break
      case 'cut':
        win.webContents.cut()
        break
      case 'copy':
        win.webContents.copy()
        break
      case 'paste':
        win.webContents.paste()
        break
      case 'selectAll':
        win.webContents.selectAll()
        break
      case 'toggleDevTools':
        win.webContents.toggleDevTools()
        break
      case 'togglefullscreen':
        win.setFullScreen(!win.isFullScreen())
        break
      case 'quit':
        app.quit()
        break
      case 'new-window':
        createWindow()
        break
    }
  })
}
