import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFsHandlers } from './ipc/fs'
import { registerSettingsHandlers } from './ipc/settings'
import { registerAiHandlers } from './ipc/openai'
import { registerOllamaHandlers } from './ipc/ollama'
import { registerGeminiHandlers } from './ipc/gemini'
import { registerTerminalHandlers, killAllTerminals } from './ipc/terminal'
import { registerGitHandlers } from './ipc/git'
import { registerSearchHandlers } from './ipc/search'
import { registerChatHistoryHandlers } from './ipc/chatHistory'
import { buildMenu } from './menu'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.rakeshsp.llmraki')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerFsHandlers()
  registerSettingsHandlers()
  registerAiHandlers()
  registerOllamaHandlers()
  registerGeminiHandlers()
  registerTerminalHandlers()
  registerGitHandlers()
  registerSearchHandlers()
  registerChatHistoryHandlers()
  buildMenu()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  killAllTerminals()
})
