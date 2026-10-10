import type { PageContext } from './types'

// Roughly 6k tokens — enough for an article or a code file, small enough to leave the model room to answer.
const MAX_PAGE_CHARS = 24_000

const PAGE_ACCESS = { origins: ['<all_urls>'] }

// Must be called straight from a click handler: Chrome only shows the permission prompt in
// response to a user gesture. Resolves immediately, without a prompt, once access was granted.
export function requestPageAccess(): Promise<boolean> {
  return chrome.permissions.request(PAGE_ACCESS)
}

export function hasPageAccess(): Promise<boolean> {
  return chrome.permissions.contains(PAGE_ACCESS)
}

export interface TabTarget {
  tabId?: number
  title: string
  url?: string
  // Set when the extension can't read or change this tab, explaining why in plain words.
  problem?: string
  // True when the only issue is that this is a browser page (New Tab, Settings, Web Store…):
  // Edit and Auto can still start from it by opening a website or switching to another tab.
  browserPage?: boolean
}

const SWITCH_HINT = 'Switch to a tab with a regular website, then try again.'

// Chrome blocks every extension on its own pages and on the Web Store; say which page it is, so
// the message isn't a mystery when the user is, say, on the extensions page they just reloaded.
function restrictedPageName(url: string): string | null {
  if (/^chrome:\/\/(newtab|new-tab-page)/.test(url) || url.startsWith('chrome-search://')) return 'the New Tab page'
  if (url.startsWith('chrome://extensions')) return 'the Extensions page (chrome://extensions)'
  if (url.startsWith('chrome://settings')) return 'Chrome Settings'
  if (/^(chrome|edge|brave|opera|vivaldi):\/\//.test(url)) return `a built-in browser page (${url.split(/[?#]/)[0]})`
  if (url.startsWith('chrome-extension://')) return "another extension's page"
  if (url.startsWith('devtools://')) return 'DevTools'
  if (url.startsWith('view-source:')) return 'a view-source page'
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)) return 'the Chrome Web Store'
  if (/^(about|data|javascript|blob):/.test(url)) return `a ${url.split(':')[0]}: page`
  return null
}

async function findActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) return tab
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return fallback
}

export async function getTargetTab(): Promise<TabTarget> {
  const tab = await findActiveTab()
  if (!tab?.id) return { title: 'No tab', problem: `There's no active tab. ${SWITCH_HINT}` }

  const url = tab.url || tab.pendingUrl
  const title = tab.title || url || 'This tab'
  if (!url) {
    // Chrome hides a tab's URL from extensions without access to it. With access to all
    // websites granted, that only leaves Chrome's own pages (New Tab, Extensions, Settings…).
    if (!(await hasPageAccess())) {
      return {
        tabId: tab.id,
        title,
        problem: 'LLMRaki doesn’t have permission to read pages yet. Turn on “Reading web pages” in Settings.'
      }
    }
    if (tab.status === 'loading') return { tabId: tab.id, title, problem: 'This tab is still loading. Try again in a moment.' }
    return {
      tabId: tab.id,
      title: 'Chrome page',
      browserPage: true,
      problem: `Chrome doesn't let extensions work on its own pages, like New Tab, Extensions or Settings. ${SWITCH_HINT}`
    }
  }

  const restricted = restrictedPageName(url)
  if (restricted) {
    return { tabId: tab.id, title, url, browserPage: true, problem: `Chrome doesn't let extensions work on ${restricted}. ${SWITCH_HINT}` }
  }
  if (url.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    return {
      tabId: tab.id,
      title,
      url,
      problem:
        'To work on files opened from your computer, turn on “Allow access to file URLs” for LLMRaki in chrome://extensions.'
    }
  }
  if (!/^(https?|file):/.test(url)) {
    return { tabId: tab.id, title, url, browserPage: true, problem: `LLMRaki can't work on ${url.split(/[?#]/)[0]}. ${SWITCH_HINT}` }
  }
  return { tabId: tab.id, title, url }
}

// Turns Chrome's scripting errors into something a person can act on.
export function friendlyScriptError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (/cannot be scripted|Cannot access contents of|Cannot access a chrome|chrome-extension:\/\/ URL of different extension/i.test(message)) {
    return new Error(`Chrome doesn't let extensions work on this page. ${SWITCH_HINT}`)
  }
  if (/Missing host permission|must request permission/i.test(message)) {
    return new Error('LLMRaki doesn’t have permission for this site. Turn on “Reading web pages” in Settings.')
  }
  if (/No tab with id|Frame with ID 0 was removed|tab was closed/i.test(message)) {
    return new Error('That tab was closed or navigated away. Try again.')
  }
  if (/error page/i.test(message)) {
    return new Error('This tab is showing an error page, so there is nothing to work with. Reload the page first.')
  }
  return err instanceof Error ? err : new Error(message)
}

export async function readActivePage(): Promise<PageContext> {
  const target = await getTargetTab()
  if (target.problem || !target.tabId || !target.url) throw new Error(target.problem ?? 'No active tab to read.')

  const [result] = await chrome.scripting
    .executeScript({
      target: { tabId: target.tabId },
      func: () => {
        const selection = window.getSelection()?.toString().trim() ?? ''
        return { selection, text: document.body?.innerText ?? '' }
      }
    })
    .catch((err) => {
      throw friendlyScriptError(err)
    })
  const data = result?.result as { selection: string; text: string } | undefined
  if (!data) throw new Error('Could not read this page.')

  const kind = data.selection ? 'selection' : 'page'
  const raw = (data.selection || data.text).replace(/\n{3,}/g, '\n\n').trim()
  if (!raw) throw new Error('This page has no readable text.')

  return {
    title: target.title,
    url: target.url,
    kind,
    text: raw.slice(0, MAX_PAGE_CHARS),
    truncated: raw.length > MAX_PAGE_CHARS
  }
}
