import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerFsHandlers } from './ipc/fs'
import { registerSettingsHandlers } from './ipc/settings'
import { registerAiHandlers } from './ipc/openai'
import { registerOllamaHandlers } from './ipc/ollama'
import { registerGeminiHandlers } from './ipc/gemini'
import { registerInlineAiHandlers } from './ipc/inlineAi'
import { registerTerminalHandlers, killAllTerminals } from './ipc/terminal'
import { registerGitHandlers } from './ipc/git'
import { registerSearchHandlers } from './ipc/search'
import { registerChatHistoryHandlers } from './ipc/chatHistory'
import { registerFsWatchHandlers } from './ipc/fsWatch'
import { buildMenu } from './menu'
import { createWindow } from './window'

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
  registerInlineAiHandlers()
  registerTerminalHandlers()
  registerGitHandlers()
  registerSearchHandlers()
  registerChatHistoryHandlers()
  registerFsWatchHandlers()
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
