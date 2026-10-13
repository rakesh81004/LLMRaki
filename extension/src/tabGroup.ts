// Puts the tabs LLMRaki works on into a coloured "LLMRaki" tab group, so it's clear at a glance
// which tabs it is controlling and whether it's still busy. One group per window, reused across
// tasks; tabs already in one of the user's own groups are left where they are.
import type { Mode } from './types'

const STORE_KEY = 'llmrakiGroups' // windowId -> groupId, for this browser session
// One colour for the group whatever the mode, with a robot to mark it as automation.
const COLORS: Record<Exclude<Mode, 'ask'>, chrome.tabGroups.Color> = {
  auto: 'blue' as chrome.tabGroups.Color,
  edit: 'blue' as chrome.tabGroups.Color
}
const TITLE_WORKING = '🤖 LLMRaki · working'
const TITLE_IDLE = '🤖 LLMRaki'

async function knownGroups(): Promise<Record<string, number>> {
  const stored = await chrome.storage.session.get(STORE_KEY).catch(() => ({}) as Record<string, unknown>)
  return (stored[STORE_KEY] as Record<string, number> | undefined) ?? {}
}

async function rememberGroup(windowId: number, groupId: number): Promise<void> {
  await chrome.storage.session.set({ [STORE_KEY]: { ...(await knownGroups()), [windowId]: groupId } }).catch(() => {})
}

// Our group in this window, if it still exists (the user may have closed or ungrouped it).
async function ourGroup(windowId: number): Promise<number | null> {
  const id = (await knownGroups())[windowId]
  if (id === undefined) return null
  const group = await chrome.tabGroups.get(id).catch(() => null)
  return group && group.windowId === windowId ? id : null
}

export async function addTabToGroup(tabId: number, mode: Exclude<Mode, 'ask'>): Promise<void> {
  if (!chrome.tabGroups || !chrome.tabs.group) return
  try {
    const tab = await chrome.tabs.get(tabId)
    // Only normal browser windows can have tab groups.
    const win = await chrome.windows.get(tab.windowId)
    if (win.type !== 'normal') return
    const existing = await ourGroup(tab.windowId)
    const inOtherGroup = tab.groupId !== -1 && tab.groupId !== existing
    if (inOtherGroup) return
    const groupId =
      tab.groupId === existing && existing !== null
        ? existing
        : await chrome.tabs.group({ tabIds: [tabId], ...(existing !== null ? { groupId: existing } : { createProperties: { windowId: tab.windowId } }) })
    await chrome.tabGroups.update(groupId, { title: TITLE_WORKING, color: COLORS[mode], collapsed: false })
    await rememberGroup(tab.windowId, groupId)
  } catch {
    // Grouping is a visual aid only; never let it get in the way of the task.
  }
}

// When a task ends, keep the group (so the user can still see which tabs were touched) but drop "working".
export async function markGroupsIdle(): Promise<void> {
  if (!chrome.tabGroups) return
  for (const groupId of Object.values(await knownGroups())) {
    await chrome.tabGroups.update(groupId, { title: TITLE_IDLE }).catch(() => {})
  }
}
