import { ipcMain, app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

const MAX_CONVERSATIONS_PER_KEY = 30
const MAX_MESSAGES_PER_CONVERSATION = 200
const MAX_KEYS = 20

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
}

interface Conversation extends ConversationSummary {
  messages: unknown[]
}

interface LegacyEntry {
  messages: unknown[]
  updatedAt: number
}

interface KeyStore {
  conversations: Conversation[]
}

interface HistoryStore {
  [key: string]: KeyStore | LegacyEntry
}

function historyPath(): string {
  return path.join(app.getPath('userData'), 'chat-history.json')
}

function isLegacyEntry(entry: KeyStore | LegacyEntry): entry is LegacyEntry {
  return !Array.isArray((entry as KeyStore).conversations)
}

function deriveTitle(messages: unknown[]): string {
  const first = messages.find(
    (m): m is { role: string; displayContent?: string; content?: string } =>
      typeof m === 'object' && m !== null && (m as { role?: string }).role === 'user'
  )
  const text = first?.displayContent ?? first?.content ?? 'New chat'
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine || 'New chat'
}

async function readStore(): Promise<HistoryStore> {
  try {
    const raw = await fs.readFile(historyPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeStore(store: HistoryStore): Promise<void> {
  await fs.writeFile(historyPath(), JSON.stringify(store), 'utf-8')
}

function getConversations(store: HistoryStore, key: string): Conversation[] {
  const entry = store[key]
  if (!entry) return []
  if (isLegacyEntry(entry)) {
    if (entry.messages.length === 0) return []
    return [
      {
        id: 'legacy',
        title: deriveTitle(entry.messages),
        updatedAt: entry.updatedAt,
        messages: entry.messages
      }
    ]
  }
  return entry.conversations
}

export function registerChatHistoryHandlers(): void {
  ipcMain.handle(
    'chatHistory:listConversations',
    async (_e, key: string): Promise<ConversationSummary[]> => {
      const store = await readStore()
      return getConversations(store, key)
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }
  )

  ipcMain.handle(
    'chatHistory:getConversation',
    async (_e, key: string, id: string): Promise<unknown[]> => {
      const store = await readStore()
      return getConversations(store, key).find((c) => c.id === id)?.messages ?? []
    }
  )

  ipcMain.handle(
    'chatHistory:saveConversation',
    async (_e, key: string, id: string, messages: unknown[]) => {
      if (messages.length === 0) return
      const store = await readStore()
      const conversations = getConversations(store, key).filter((c) => c.id !== id)
      conversations.unshift({
        id,
        title: deriveTitle(messages),
        updatedAt: Date.now(),
        messages: messages.slice(-MAX_MESSAGES_PER_CONVERSATION)
      })
      store[key] = { conversations: conversations.slice(0, MAX_CONVERSATIONS_PER_KEY) }

      const keys = Object.keys(store)
      if (keys.length > MAX_KEYS) {
        const latestUpdate = (k: string): number => {
          const e = store[k]
          return isLegacyEntry(e) ? e.updatedAt : (e.conversations[0]?.updatedAt ?? 0)
        }
        const sorted = keys.sort((a, b) => latestUpdate(a) - latestUpdate(b))
        for (const k of sorted.slice(0, keys.length - MAX_KEYS)) delete store[k]
      }
      await writeStore(store)
    }
  )

  ipcMain.handle('chatHistory:deleteConversation', async (_e, key: string, id: string) => {
    const store = await readStore()
    const conversations = getConversations(store, key).filter((c) => c.id !== id)
    store[key] = { conversations }
    await writeStore(store)
  })
}
