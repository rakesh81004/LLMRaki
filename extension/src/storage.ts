import { DEFAULT_SETTINGS, type Conversation, type Settings } from './types'

const SETTINGS_KEY = 'settings'
const CONVERSATIONS_KEY = 'conversations'
const MAX_CONVERSATIONS = 100

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

export async function loadConversations(): Promise<Conversation[]> {
  const stored = await chrome.storage.local.get(CONVERSATIONS_KEY)
  const list = (stored[CONVERSATIONS_KEY] as Conversation[] | undefined) ?? []
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveConversation(conversation: Conversation): Promise<Conversation[]> {
  const list = (await loadConversations()).filter((c) => c.id !== conversation.id)
  const next = [conversation, ...list].slice(0, MAX_CONVERSATIONS)
  await chrome.storage.local.set({ [CONVERSATIONS_KEY]: next })
  return next
}

export async function deleteConversation(id: string): Promise<Conversation[]> {
  const next = (await loadConversations()).filter((c) => c.id !== id)
  await chrome.storage.local.set({ [CONVERSATIONS_KEY]: next })
  return next
}
