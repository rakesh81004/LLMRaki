// Pinned chats are permanent: everything the user shares in one — messages, files, answers typed
// mid-task — is sent along with every request in it, so it's "remembered" for good. Only the last
// few turns go in as conversation, which keeps requests a sensible size however long the chat gets.
import type { Attachment, ChatMessage, Conversation } from './types'

// Turns of the actual conversation sent before the new message.
const RECENT_MESSAGES = 4
// Caps on what is sent as the chat's memory, newest kept first.
const MAX_NOTE_CHARS = 4_000
const MAX_NOTES_CHARS = 60_000
const MAX_FILES = 8

export interface PinnedMemory {
  // What the user wrote, oldest first (each message, and anything typed while a task ran).
  notes: string[]
  // Their files, newest version of each name.
  files: Attachment[]
}

// Everything the user has shared in the chat so far.
export function pinnedMemory(messages: ChatMessage[]): PinnedMemory {
  const notes: string[] = []
  const files = new Map<string, Attachment>()
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.trim()) notes.push(m.content.trim())
      for (const a of m.attachments ?? []) {
        // An automation's own instructions are added fresh on each run, not remembered.
        if (a.name.endsWith('— AUTOMATION.md')) continue
        files.delete(a.name)
        files.set(a.name, a)
      }
    }
    for (const s of m.steps ?? []) if (s.kind === 'message' && s.label.trim()) notes.push(s.label.trim())
  }
  return { notes, files: [...files.values()].slice(-MAX_FILES) }
}

// The history to send for a new message in a pinned chat: the chat's memory, then the last few
// turns, then the new message (with any automation instructions and media attached).
export function pinnedHistory(previous: ChatMessage[], latest: ChatMessage, extra: Attachment[] = []): ChatMessage[] {
  const memory = pinnedMemory(previous)
  let budget = MAX_NOTES_CHARS
  const kept: string[] = []
  for (const note of [...memory.notes].reverse()) {
    const text = note.slice(0, MAX_NOTE_CHARS)
    if (budget - text.length < 0) break
    budget -= text.length
    kept.unshift(text)
  }
  const recent = previous.filter((m) => !m.error).slice(-RECENT_MESSAGES)
  while (recent.length && recent[0].role !== 'user') recent.shift()
  const out: ChatMessage[] = []
  if (kept.length > 0 || memory.files.length > 0) {
    out.push(
      {
        role: 'user',
        content:
          '[Pinned chat memory — everything the user has shared in this chat, oldest first. It is about them: use all of it, every time, as the source of truth for their details. When two things disagree, the newer one wins.]\n' +
          (kept.length ? kept.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(Only files so far.)'),
        attachments: memory.files
      },
      { role: 'assistant', content: 'Noted — I will use all of this, with newer details taking priority.' }
    )
  }
  // Earlier turns are kept for flow only; their files are already in the memory above.
  out.push(...recent.map((m) => ({ ...m, attachments: undefined, page: undefined })))
  out.push({ ...latest, attachments: [...extra, ...(latest.attachments ?? [])] })
  return out
}

// The user's files that can go into upload fields: from the message, the chat's memory and the
// automation's media. Newest of each name wins.
export function uploadableFiles(groups: Attachment[][]): { name: string; mimeType: string; data: string }[] {
  const byName = new Map<string, { name: string; mimeType: string; data: string }>()
  for (const a of groups.flat()) if (a.file) byName.set(a.name, { name: a.name, mimeType: a.mimeType, data: a.file })
  return [...byName.values()]
}

// Saved chats don't keep the original file bytes, except pinned ones (needed for later uploads).
export function withoutFileBytes(conversation: Conversation): Conversation {
  if (conversation.pinned) return conversation
  return {
    ...conversation,
    messages: conversation.messages.map((m) =>
      m.attachments?.some((a) => a.file) ? { ...m, attachments: m.attachments.map(({ file: _file, ...a }) => a) } : m
    )
  }
}
