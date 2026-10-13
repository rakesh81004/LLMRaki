// Automations: repeatable tasks with their own instructions and media files (e.g. a résumé).
// Built-in ones come from the repo's automations/ folders, bundled at build time; the user's own
// live in Settings. Running one attaches its instructions and every media file to the message, so
// they're read on every run.
import { readAttachment } from './attachments'
import type { Attachment, Mode } from './types'

export interface AutomationInfo {
  name: string
  title: string
  trigger: string
  mode: Mode
  description: string
  builtIn: boolean
  // Built-in: paths inside the extension. Yours: the instructions text and files themselves.
  instructionsPath?: string
  mediaPaths?: { name: string; path: string }[]
  instructions?: string
  media?: Attachment[]
}

export interface CustomAutomation {
  name: string
  title: string
  trigger: string
  mode: Mode
  description: string
  instructions: string
  media: Attachment[]
}

export async function loadBuiltInAutomations(): Promise<AutomationInfo[]> {
  try {
    const response = await fetch(chrome.runtime.getURL('automations/index.json'), { cache: 'no-store' })
    if (!response.ok) return []
    const list = (await response.json()) as {
      name: string
      title: string
      trigger: string
      mode: Mode
      description: string
      instructions: string
      media: { name: string; path: string }[]
    }[]
    return list.map((a) => ({ ...a, builtIn: true, instructionsPath: a.instructions, mediaPaths: a.media, instructions: undefined, media: undefined }))
  } catch {
    return []
  }
}

export function allAutomations(builtIn: AutomationInfo[], custom: CustomAutomation[] = []): AutomationInfo[] {
  const mine: AutomationInfo[] = custom.map((c) => ({ ...c, builtIn: false }))
  // One of yours with the same name replaces the built-in one.
  return [...builtIn.filter((b) => !mine.some((m) => m.name === b.name)), ...mine]
}

// The automation whose trigger word appears in the message, if any (whole words, any case).
export function findTriggered(text: string, automations: AutomationInfo[]): AutomationInfo | undefined {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
  return automations.find((a) => a.trigger && lower.includes(` ${a.trigger.toLowerCase().trim()} `.replace(/\s+/g, ' ')))
}

// Tells the model how to carry out instructions written for other assistants with LLMRaki's own tools.
const HOW_TO_RUN = `[How LLMRaki carries out this automation]
- You are working in the user's own logged-in Chrome. Where these instructions mention running JavaScript, page-text tools or screenshots, use your own tools for the same result: open_url, read_page, scroll_page, click, fill_field, press_key, list_tabs, switch_to_tab, close_tab and wait. read_page gives you the page text and its links/buttons.
- Where they mention a history, tracker or memory file (for example "colddm-tracker"), call recall with that name at the start, and save to it with remember (start each note with the tracker's name) before you finish.
- When it applies to jobs, call list_applications first so nothing is applied to twice, and record every outcome with log_application — "failed" with the exact reason when an application doesn't go through, so LLMRaki can retry it once and then ask the user.
- When it says to ask the user, get approval or wait for a choice (a shortlist, an unknown answer), stop and ask in your reply; the user's answer arrives as their next message, and you continue from there.
- The files attached with this automation (for example a résumé) are the user's own and the source of truth about them.
- Follow the automation's own rules about what needs the user's explicit go-ahead.
[End of note — the automation follows]

`

// Everything the automation needs on a run: its instructions and media, as message attachments.
const mediaCache = new Map<string, Attachment>()
export async function prepareAutomation(automation: AutomationInfo): Promise<Attachment[]> {
  let instructions = automation.instructions ?? ''
  let media: Attachment[] = automation.media ?? []
  if (automation.builtIn) {
    const response = await fetch(chrome.runtime.getURL(automation.instructionsPath ?? ''), { cache: 'no-store' })
    if (!response.ok) throw new Error(`Couldn't load the ${automation.title} instructions.`)
    instructions = await response.text()
    media = []
    for (const file of automation.mediaPaths ?? []) {
      let attachment = mediaCache.get(file.path)
      if (!attachment) {
        const blob = await (await fetch(chrome.runtime.getURL(file.path))).blob()
        attachment = await readAttachment(new File([blob], file.name, { type: blob.type }))
        mediaCache.set(file.path, attachment)
      }
      media.push(attachment)
    }
  }
  const instructionsAttachment: Attachment = {
    name: `${automation.title} — AUTOMATION.md`,
    size: instructions.length,
    mimeType: 'text/markdown',
    kind: 'text',
    text: HOW_TO_RUN + instructions
  }
  return [instructionsAttachment, ...media]
}
