import { ipcMain, app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

export type Provider = 'openai' | 'ollama' | 'gemini'

interface StoredSettings {
  apiKeyEncrypted?: string
  model?: string
  recentFolders?: RecentFolder[]
  provider?: Provider
  ollamaModel?: string
  geminiApiKeyEncrypted?: string
  geminiModel?: string
}

const MAX_RECENT_FOLDERS = 10

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<StoredSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeSettings(settings: StoredSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:hasApiKey', async () => {
    const settings = await readSettings()
    return Boolean(settings.apiKeyEncrypted)
  })

  ipcMain.handle('settings:setApiKey', async (_e, apiKey: string) => {
    const settings = await readSettings()
    if (safeStorage.isEncryptionAvailable()) {
      settings.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64')
    } else {
      // Rare fallback: OS keychain unavailable, so store base64 instead of real encryption.
      settings.apiKeyEncrypted = Buffer.from(apiKey, 'utf-8').toString('base64')
    }
    await writeSettings(settings)
  })

  ipcMain.handle('settings:clearApiKey', async () => {
    const settings = await readSettings()
    delete settings.apiKeyEncrypted
    await writeSettings(settings)
  })

  ipcMain.handle('settings:getModel', async () => {
    const settings = await readSettings()
    return settings.model ?? 'gpt-4o-mini'
  })

  ipcMain.handle('settings:setModel', async (_e, model: string) => {
    const settings = await readSettings()
    settings.model = model
    await writeSettings(settings)
  })

  ipcMain.handle('settings:getProvider', async () => {
    const settings = await readSettings()
    return settings.provider ?? 'ollama'
  })

  ipcMain.handle('settings:setProvider', async (_e, provider: Provider) => {
    const settings = await readSettings()
    settings.provider = provider
    await writeSettings(settings)
  })

  ipcMain.handle('settings:getOllamaModel', async () => {
    const settings = await readSettings()
    return settings.ollamaModel ?? 'llama3.2'
  })

  ipcMain.handle('settings:setOllamaModel', async (_e, model: string) => {
    const settings = await readSettings()
    settings.ollamaModel = model
    await writeSettings(settings)
  })

  ipcMain.handle('settings:hasGeminiKey', async () => {
    const settings = await readSettings()
    return Boolean(settings.geminiApiKeyEncrypted)
  })

  ipcMain.handle('settings:setGeminiKey', async (_e, apiKey: string) => {
    const settings = await readSettings()
    if (safeStorage.isEncryptionAvailable()) {
      settings.geminiApiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64')
    } else {
      settings.geminiApiKeyEncrypted = Buffer.from(apiKey, 'utf-8').toString('base64')
    }
    await writeSettings(settings)
  })

  ipcMain.handle('settings:clearGeminiKey', async () => {
    const settings = await readSettings()
    delete settings.geminiApiKeyEncrypted
    await writeSettings(settings)
  })

  ipcMain.handle('settings:getGeminiModel', async () => {
    const settings = await readSettings()
    return settings.geminiModel ?? 'gemini-3.6-flash'
  })

  ipcMain.handle('settings:setGeminiModel', async (_e, model: string) => {
    const settings = await readSettings()
    settings.geminiModel = model
    await writeSettings(settings)
  })

  ipcMain.handle('settings:getRecentFolders', async () => {
    return getRecentFolders()
  })

  ipcMain.handle('settings:removeRecentFolder', async (_e, folderPath: string) => {
    return removeRecentFolder(folderPath)
  })

  ipcMain.handle('settings:clearRecentFolders', async () => {
    const settings = await readSettings()
    settings.recentFolders = []
    await writeSettings(settings)
  })
}

export async function getRecentFolders(): Promise<RecentFolder[]> {
  const settings = await readSettings()
  return (settings.recentFolders ?? []).sort((a, b) => b.lastOpened - a.lastOpened)
}

export async function addRecentFolder(folderPath: string): Promise<RecentFolder[]> {
  const settings = await readSettings()
  const existing = (settings.recentFolders ?? []).filter((f) => f.path !== folderPath)
  const name = path.basename(folderPath)
  existing.unshift({ path: folderPath, name, lastOpened: Date.now() })
  settings.recentFolders = existing.slice(0, MAX_RECENT_FOLDERS)
  await writeSettings(settings)
  return settings.recentFolders
}

export async function removeRecentFolder(folderPath: string): Promise<RecentFolder[]> {
  const settings = await readSettings()
  settings.recentFolders = (settings.recentFolders ?? []).filter((f) => f.path !== folderPath)
  await writeSettings(settings)
  return settings.recentFolders
}

export async function getDecryptedApiKey(): Promise<string | null> {
  const settings = await readSettings()
  if (!settings.apiKeyEncrypted) return null
  const buf = Buffer.from(settings.apiKeyEncrypted, 'base64')
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(buf)
  }
  return buf.toString('utf-8')
}

export async function getModel(): Promise<string> {
  const settings = await readSettings()
  return settings.model ?? 'gpt-4o-mini'
}

export async function getDecryptedGeminiKey(): Promise<string | null> {
  const settings = await readSettings()
  if (!settings.geminiApiKeyEncrypted) return null
  const buf = Buffer.from(settings.geminiApiKeyEncrypted, 'base64')
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(buf)
  }
  return buf.toString('utf-8')
}

export async function getGeminiModel(): Promise<string> {
  const settings = await readSettings()
  return settings.geminiModel ?? 'gemini-3.6-flash'
}
