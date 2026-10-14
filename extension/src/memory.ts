// What LLMRaki keeps between tasks: a log of jobs it applied to (so "10 more" means 10 new ones
// and nothing is applied to twice) and free-form notes it chose to remember.

export interface ApplicationRecord {
  id: string
  title: string
  company: string
  url: string
  site: string
  status: 'applied' | 'skipped' | 'external' | 'failed'
  note?: string
  at: number
}

export interface MemoryNote {
  id: string
  text: string
  at: number
}

const APPLICATIONS_KEY = 'applications'
const NOTES_KEY = 'memoryNotes'
const MAX_NOTES = 200

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Job links often carry tracking parameters; compare them without those.
export function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return url
  }
}

export async function loadApplications(): Promise<ApplicationRecord[]> {
  const stored = await chrome.storage.local.get(APPLICATIONS_KEY)
  return ((stored[APPLICATIONS_KEY] as ApplicationRecord[] | undefined) ?? []).sort((a, b) => b.at - a.at)
}

export async function logApplication(record: Omit<ApplicationRecord, 'id' | 'at' | 'site'>): Promise<{ duplicate: boolean; total: number }> {
  const list = await loadApplications()
  const key = normalizeJobUrl(record.url)
  const duplicate = !!record.url && list.some((r) => r.status === 'applied' && normalizeJobUrl(r.url) === key)
  if (!duplicate) {
    list.unshift({ ...record, id: crypto.randomUUID(), at: Date.now(), site: siteOf(record.url) })
    await chrome.storage.local.set({ [APPLICATIONS_KEY]: list })
  }
  return { duplicate, total: list.filter((r) => r.status === 'applied').length }
}

export async function deleteApplication(id: string): Promise<ApplicationRecord[]> {
  const list = (await loadApplications()).filter((r) => r.id !== id)
  await chrome.storage.local.set({ [APPLICATIONS_KEY]: list })
  return list
}

export async function clearApplications(): Promise<void> {
  await chrome.storage.local.set({ [APPLICATIONS_KEY]: [] })
}

export async function loadNotes(): Promise<MemoryNote[]> {
  const stored = await chrome.storage.local.get(NOTES_KEY)
  return ((stored[NOTES_KEY] as MemoryNote[] | undefined) ?? []).sort((a, b) => b.at - a.at)
}

export async function addNote(text: string): Promise<void> {
  const list = [{ id: crypto.randomUUID(), text: text.trim().slice(0, 1000), at: Date.now() }, ...(await loadNotes())].slice(0, MAX_NOTES)
  await chrome.storage.local.set({ [NOTES_KEY]: list })
}

export async function deleteNote(id: string): Promise<MemoryNote[]> {
  const list = (await loadNotes()).filter((n) => n.id !== id)
  await chrome.storage.local.set({ [NOTES_KEY]: list })
  return list
}

// Memory files: named, growing documents such as an automation's tracker ("colddm-tracker"), for
// histories too long for a note. Added to, never overwritten, so a run can't wipe earlier ones.
export interface MemoryFile {
  name: string
  text: string
  updatedAt: number
}

const FILES_KEY = 'memoryFiles'
const MAX_FILE_CHARS = 200_000

// "/areas/colddm-tracker.md", "colddm-tracker.md" and "Colddm Tracker" all mean "colddm-tracker".
export function memoryFileName(raw: string): string {
  const last = raw.trim().split(/[\/]/).pop() ?? ''
  return last
    .replace(/\.(md|markdown|txt)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function loadMemoryFiles(): Promise<MemoryFile[]> {
  const stored = await chrome.storage.local.get(FILES_KEY)
  return Object.values((stored[FILES_KEY] as Record<string, MemoryFile> | undefined) ?? {}).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function readMemoryFile(name: string): Promise<MemoryFile | undefined> {
  const stored = await chrome.storage.local.get(FILES_KEY)
  return ((stored[FILES_KEY] as Record<string, MemoryFile> | undefined) ?? {})[memoryFileName(name)]
}

// Adds text to the end of the file, creating it if needed. Past the size cap the oldest lines go.
export async function appendMemoryFile(name: string, text: string): Promise<MemoryFile> {
  const key = memoryFileName(name)
  const stored = await chrome.storage.local.get(FILES_KEY)
  const files = (stored[FILES_KEY] as Record<string, MemoryFile> | undefined) ?? {}
  const before = files[key]?.text ?? ''
  let combined = before ? `${before.replace(/\n+$/, '')}\n${text.trim()}\n` : `${text.trim()}\n`
  if (combined.length > MAX_FILE_CHARS) {
    const cut = combined.indexOf('\n', combined.length - MAX_FILE_CHARS)
    combined = combined.slice(cut + 1)
  }
  const file = { name: key, text: combined, updatedAt: Date.now() }
  await chrome.storage.local.set({ [FILES_KEY]: { ...files, [key]: file } })
  return file
}

export async function deleteMemoryFile(name: string): Promise<MemoryFile[]> {
  const stored = await chrome.storage.local.get(FILES_KEY)
  const files = { ...((stored[FILES_KEY] as Record<string, MemoryFile> | undefined) ?? {}) }
  delete files[memoryFileName(name)]
  await chrome.storage.local.set({ [FILES_KEY]: files })
  return loadMemoryFiles()
}
