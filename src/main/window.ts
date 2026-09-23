import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // `titleBarStyle: 'hiddenInset'` above is macOS-only — Electron silently ignores it on
  // Windows/Linux, which fall back to the full native frame *and* native application menu
  // (Menu.setApplicationMenu in menu.ts), rendered as a separate OS-themed strip outside the
  // app's own dark UI. Hiding the menu bar here (not removing the Menu itself) keeps every
  // accelerator in menu.ts's template working — only the visible native strip goes away, so
  // MenuBar.tsx can draw an in-page equivalent that actually matches the app's theme.
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
  }

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
