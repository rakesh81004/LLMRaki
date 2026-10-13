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
