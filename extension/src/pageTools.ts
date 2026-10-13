import { friendlyScriptError } from './pageContext'

// Page actions for Edit and Auto mode. Each *InPage function is injected into the tab with
// chrome.scripting.executeScript, so it must be fully self-contained: no imports, no closures
// over module scope — only its own arguments and the page's DOM.

export interface PageElement {
  ref: string
  tag: string
  type?: string
  label: string
  value?: string
  checked?: boolean
  options?: string[]
  disabled?: boolean
  required?: boolean
  // Password and payment fields: listed so the model knows they exist, but never filled by it.
  protected?: boolean
}

export interface PageSnapshot {
  title: string
  url: string
  text: string
  textTruncated: boolean
  elements: PageElement[]
  elementsTruncated: boolean
}

export interface FillResult {
  ok: boolean
  error?: string
  label?: string
  previous?: string
  // Set when the field was a password or payment field, so the attempted value is never shown or saved.
  blocked?: boolean
}

export interface ClickInfo {
  ok: boolean
  error?: string
  label?: string
  submits?: boolean
}

function snapshotInPage(maxText: number, maxElements: number): PageSnapshot {
  const clean = (s: string | null | undefined, max = 80): string =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  const isProtected = (el: Element): boolean => {
    if (!(el instanceof HTMLInputElement)) return false
    const auto = (el.autocomplete || '').toLowerCase()
    return el.type === 'password' || auto.startsWith('cc-') || /current-password|new-password|one-time-code/.test(auto)
  }

  // A <label> that wraps its control would otherwise include the control's own text (every option of a dropdown).
  const labelText = (label: Element): string => {
    const copy = label.cloneNode(true) as Element
    copy.querySelectorAll('select, input, textarea').forEach((n) => n.remove())
    return copy.textContent ?? ''
  }

  const labelOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
      if (clean(text)) return clean(text)
    }
    const field = el as HTMLInputElement
    if (field.labels && field.labels.length > 0 && clean(labelText(field.labels[0]))) {
      return clean(labelText(field.labels[0]))
    }
    const placeholder = el.getAttribute('placeholder')
    if (placeholder) return clean(placeholder)
    const wrapping = el.closest('label')
    if (wrapping && clean(labelText(wrapping))) return clean(labelText(wrapping))
    const text = (el as HTMLElement).innerText
    if (text && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      return clean(text)
    }
    return clean(
      el.getAttribute('title') || el.getAttribute('alt') || field.value || el.getAttribute('name') || el.id || el.tagName
    )
  }

  // Form controls first, then buttons, then links — on link-heavy pages the controls matter most.
  const groups = [
    'input:not([type="hidden"]), textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"]',
    'button, input[type="submit"], input[type="button"], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary',
    'a[href], [role="link"]'
  ]
  const linkCap = Math.floor(maxElements / 3)
  let nextRef = Number(document.documentElement.getAttribute('data-llmraki-next-ref') || '1')
  const seen = new Set<Element>()
  const elements: PageElement[] = []
  let truncated = false

  groups.forEach((selector, groupIndex) => {
    let linkCount = 0
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (seen.has(el) || !isVisible(el)) continue
      if (elements.length >= maxElements || (groupIndex === 2 && linkCount >= linkCap)) {
        truncated = true
        break
      }
      seen.add(el)
      if (groupIndex === 2) linkCount++

      // Refs stay on the element across snapshots, so the model's earlier refs keep working.
      let ref = el.getAttribute('data-llmraki-ref')
      if (!ref) {
        ref = `e${nextRef++}`
        el.setAttribute('data-llmraki-ref', ref)
      }

      const entry: PageElement = { ref, tag: el.tagName.toLowerCase(), label: labelOf(el) }
      const role = el.getAttribute('role')
      if (role) entry.type = role
      if (el instanceof HTMLInputElement) {
        entry.type = el.type
        if (el.type === 'checkbox' || el.type === 'radio') entry.checked = el.checked
        else entry.value = isProtected(el) ? undefined : clean(el.value, 120)
      } else if (el instanceof HTMLTextAreaElement) {
        entry.value = clean(el.value, 120)
      } else if (el instanceof HTMLSelectElement) {
        entry.value = clean(el.selectedOptions[0]?.text)
        entry.options = Array.from(el.options)
          .slice(0, 40)
          .map((o) => clean(o.text, 60))
      } else if ((el as HTMLElement).isContentEditable) {
        entry.value = clean((el as HTMLElement).innerText, 120)
      } else if (el instanceof HTMLAnchorElement) {
        entry.value = clean(el.href, 120)
      }
      if (role === 'checkbox' || role === 'radio' || role === 'switch') {
        entry.checked = el.getAttribute('aria-checked') === 'true'
      }
      if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') entry.disabled = true
      if ((el as HTMLInputElement).required) entry.required = true
      if (isProtected(el)) entry.protected = true
      elements.push(entry)
    }
  })
  document.documentElement.setAttribute('data-llmraki-next-ref', String(nextRef))

  const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim()
  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, maxText),
    textTruncated: text.length > maxText,
    elements,
    elementsTruncated: truncated
  }
}

function fillInPage(ref: string, value: string): FillResult {
  const el = document.querySelector(`[data-llmraki-ref="${CSS.escape(ref)}"]`) as HTMLElement | null
  if (!el) return { ok: false, error: `Element ${ref} isn't on the page any more. Call read_page again.` }

  const firstLabel = (el as HTMLInputElement).labels?.[0]
  let labelText = ''
  if (firstLabel) {
    const copy = firstLabel.cloneNode(true) as Element
    copy.querySelectorAll('select, input, textarea').forEach((n) => n.remove())
    labelText = copy.textContent ?? ''
  }
  const label = (el.getAttribute('aria-label') || labelText.trim() ||
    el.getAttribute('placeholder') || el.getAttribute('name') || el.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 60)

  if (el instanceof HTMLInputElement) {
    const auto = (el.autocomplete || '').toLowerCase()
    if (el.type === 'password' || auto.startsWith('cc-') || /current-password|new-password|one-time-code/.test(auto)) {
      return { ok: false, blocked: true, label, error: 'Password and payment fields are filled in by the user, never by the assistant.' }
    }
  }
  if ((el as HTMLInputElement).disabled) return { ok: false, label, error: `"${label}" is disabled.` }

  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  const oldOutline = el.style.outline
  el.style.outline = '2px solid #a855f7'
  setTimeout(() => (el.style.outline = oldOutline), 1200)

  const fire = (target: Element): void => {
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const wantChecked = /^(true|yes|on|1|checked|check)$/i.test(value.trim())

  if (el instanceof HTMLSelectElement) {
    const target = value.trim().toLowerCase()
    const options = Array.from(el.options)
    const match =
      options.find((o) => o.value.toLowerCase() === target || o.text.trim().toLowerCase() === target) ??
      options.find((o) => o.text.toLowerCase().includes(target))
    if (!match) {
      return { ok: false, label, error: `No option matching "${value}". Options: ${options.map((o) => o.text.trim()).slice(0, 40).join(' | ')}` }
    }
    const previous = el.selectedOptions[0]?.text.trim() ?? ''
    el.value = match.value
    fire(el)
    return { ok: true, label, previous }
  }

  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const previous = String(el.checked)
    if (el.checked !== wantChecked) el.click()
    return { ok: true, label, previous }
  }

  const role = el.getAttribute('role')
  if (role === 'checkbox' || role === 'switch' || role === 'radio') {
    const checked = el.getAttribute('aria-checked') === 'true'
    if (checked !== wantChecked) el.click()
    return { ok: true, label, previous: String(checked) }
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // Going through the prototype's setter (not el.value = …) lets frameworks such as React
    // notice the change, since they compare against the value they last wrote themselves.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    const previous = el.value
    el.focus()
    if (setter) setter.call(el, value)
    else el.value = value
    fire(el)
    return { ok: true, label, previous }
  }

  if (el.isContentEditable || role === 'textbox') {
    const previous = el.innerText
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // insertText goes through the editor's own input handling, so rich editors keep their state in sync.
    if (!document.execCommand('insertText', false, value)) el.innerText = value
    fire(el)
    return { ok: true, label, previous }
  }

  return { ok: false, label, error: `"${label}" (${el.tagName.toLowerCase()}) isn't a field that can be filled. Use click instead.` }
}

function inspectClickInPage(ref: string): ClickInfo {
  const el = document.querySelector(`[data-llmraki-ref="${CSS.escape(ref)}"]`) as HTMLElement | null
  if (!el) return { ok: false, error: `Element ${ref} isn't on the page any more. Call read_page again.` }
  const label = (el.getAttribute('aria-label') || el.innerText || (el as HTMLInputElement).value ||
    el.getAttribute('title') || el.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 60)
  const submits =
    (el instanceof HTMLButtonElement && el.type === 'submit' && !!el.form) ||
    (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image'))
  return { ok: true, label, submits }
}

function clickInPage(ref: string): ClickInfo {
  const el = document.querySelector(`[data-llmraki-ref="${CSS.escape(ref)}"]`) as HTMLElement | null
  if (!el) return { ok: false, error: `Element ${ref} isn't on the page any more. Call read_page again.` }
  if ((el as HTMLButtonElement).disabled) return { ok: false, error: 'That element is disabled.' }
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  const oldOutline = el.style.outline
  el.style.outline = '2px solid #ff8c00'
  setTimeout(() => (el.style.outline = oldOutline), 1200)
  el.click()
  return { ok: true }
}

export interface ScrollResult {
  ok: boolean
  atBottom: boolean
  moved: number
}

function scrollInPage(direction: string): ScrollResult {
  // Lists that load more as you scroll often live in their own scrolling panel, not the window.
  const candidates = [document.scrollingElement as HTMLElement, ...Array.from(document.querySelectorAll<HTMLElement>('main, section, div, ul'))]
  const scroller =
    candidates.find((el) => el && el.scrollHeight - el.clientHeight > 200 && el.clientHeight > window.innerHeight * 0.5 &&
      (el === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(el).overflowY))) ??
    (document.scrollingElement as HTMLElement)
  const before = scroller.scrollTop
  const page = Math.max(200, Math.round(scroller.clientHeight * 0.85))
  if (direction === 'top') scroller.scrollTop = 0
  else if (direction === 'bottom') scroller.scrollTop = scroller.scrollHeight
  else scroller.scrollTop = before + (direction === 'up' ? -page : page)
  const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
  return { ok: true, atBottom, moved: Math.round(scroller.scrollTop - before) }
}

function pressKeyInPage(ref: string, key: string): ClickInfo {
  const el = ref ? (document.querySelector(`[data-llmraki-ref="${CSS.escape(ref)}"]`) as HTMLElement | null) : (document.activeElement as HTMLElement | null)
  if (ref && !el) return { ok: false, error: `Element ${ref} isn't on the page any more. Call read_page again.` }
  const target = el ?? document.body
  target.focus?.()
  const codes: Record<string, [string, number]> = { Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38] }
  const [code, keyCode] = codes[key] ?? [key, 0]
  const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }
  const notCancelled = target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keypress', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  // Pages ignore a script's key presses for their built-in behaviour, so do what a real Enter would:
  // submit the surrounding form, unless the page's own key handler already dealt with it.
  if (key === 'Enter' && notCancelled && target instanceof HTMLInputElement && target.form) target.form.requestSubmit()
  return { ok: true }
}

async function run<A extends unknown[], R>(tabId: number, func: (...args: A) => R, args: A): Promise<R> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args }).catch((err) => {
    throw friendlyScriptError(err)
  })
  if (!result) throw new Error('The page did not respond.')
  return result.result as R
}

export const snapshotPage = (tabId: number): Promise<PageSnapshot> => run(tabId, snapshotInPage, [12_000, 150])
export const fillField = (tabId: number, ref: string, value: string): Promise<FillResult> =>
  run(tabId, fillInPage, [ref, value])
export const inspectClick = (tabId: number, ref: string): Promise<ClickInfo> => run(tabId, inspectClickInPage, [ref])
export const clickElement = (tabId: number, ref: string): Promise<ClickInfo> => run(tabId, clickInPage, [ref])
export const scrollPage = (tabId: number, direction: string): Promise<ScrollResult> => run(tabId, scrollInPage, [direction])
export const pressKey = (tabId: number, ref: string, key: string): Promise<ClickInfo> => run(tabId, pressKeyInPage, [ref, key])

// A click can start a navigation; give the new page a moment to load before the next read.
export async function waitForPageSettled(tabId: number): Promise<void> {
  await new Promise((r) => setTimeout(r, 600))
  for (let i = 0; i < 20; i++) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab || tab.status === 'complete') return
    await new Promise((r) => setTimeout(r, 400))
  }
}
