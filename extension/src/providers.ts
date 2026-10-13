import type { AgentStep, Attachment, ChatMessage, PageContext, Provider, Settings } from './types'

export const OLLAMA_BASE_URL = 'http://localhost:11434'

// Said in terms of the AI provider, since "localhost" in an error otherwise reads like a web page problem.
export const OLLAMA_UNREACHABLE =
  'LLMRaki is set to use Ollama, which runs the AI on your own computer, but Ollama isn’t running. ' +
  'Switch to Gemini in Settings (it only needs a free key), or install Ollama and start it with "ollama serve".'

export const ASK_SYSTEM_PROMPT =
  'You are LLMRaki, a helpful assistant running in a browser side panel. Answer clearly and ' +
  'concisely using Markdown. When the user attaches a web page or selected text, ground your ' +
  'answer in it and say so when the answer is not in the provided content. You are in Ask mode, ' +
  'so you cannot type into or click anything on the page; if the user wants that done, tell them ' +
  'to switch to Edit or Auto mode below the message box.'

export interface WireImage {
  mimeType: string
  data: string
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: WireImage[]
}

// Images are re-sent with every later turn so follow-up questions can refer to them; only the
// most recent few are kept, since each one costs a lot of a request's size and quota.
const MAX_IMAGES_PER_REQUEST = 4

function formatAttachments(attachments: Attachment[]): string {
  return attachments
    .filter((a) => a.kind === 'text')
    .map((a) => `Attached file “${a.name}”:\n<file>\n${a.text}\n</file>${a.truncated ? '\n[File was truncated to fit.]' : ''}`)
    .join('\n\n')
}

function describeSteps(steps: AgentStep[]): string {
  const done = steps
    .filter((s) => s.kind !== 'read' && s.kind !== 'message')
    .map((s) => `${s.label}${s.detail ? ` (${s.detail})` : ''}: ${s.status}`)
  const added = steps.filter((s) => s.kind === 'message').map((s) => `“${s.label}”`)
  return (
    (added.length > 0 ? `\n\n[The user added during this task: ${added.join('; ')}]` : '') +
    (done.length > 0 ? `\n\n[Page actions in this turn — ${done.join('; ')}]` : '')
  )
}

function formatPage(page: PageContext): string {
  const label = page.kind === 'selection' ? 'Text selected on the page' : 'Page content'
  const note = page.truncated ? '\n[Content was truncated to fit.]' : ''
  return `${label} — "${page.title}" (${page.url}):\n<page>\n${page.text}\n</page>${note}`
}

// Page text rides along inside the user turn it was attached to, so follow-up questions in the
// same conversation still have it without the user re-attaching.
export function toWireMessages(messages: ChatMessage[], systemPrompt = ASK_SYSTEM_PROMPT): WireMessage[] {
  const kept = messages.filter((m) => !m.error && (m.content.trim() || m.steps?.length || m.attachments?.length))
  // Which images still fit, counting back from the newest message.
  let imageBudget = MAX_IMAGES_PER_REQUEST
  const imagesFor = new Map<ChatMessage, WireImage[]>()
  for (const m of [...kept].reverse()) {
    const images = (m.attachments ?? []).filter((a) => a.kind === 'image' && a.data)
    const fit = images.slice(Math.max(0, images.length - imageBudget))
    imageBudget -= fit.length
    if (fit.length > 0) imagesFor.set(m, fit.map((a) => ({ mimeType: a.mimeType, data: a.data! })))
  }
  return [
    { role: 'system', content: systemPrompt },
    ...kept.map((m) => {
      const files = m.attachments?.length ? formatAttachments(m.attachments) : ''
      const droppedImages = (m.attachments ?? []).filter((a) => a.kind === 'image').length - (imagesFor.get(m)?.length ?? 0)
      const parts = [
        m.page ? formatPage(m.page) : '',
        files,
        droppedImages > 0 ? `[${droppedImages} earlier image${droppedImages === 1 ? '' : 's'} not re-sent to save space.]` : '',
        m.content
      ].filter(Boolean)
      return {
        role: m.role,
        content: parts.join('\n\n') + (m.steps ? describeSteps(m.steps) : ''),
        ...(imagesFor.has(m) ? { images: imagesFor.get(m) } : {})
      }
    })
  ]
}

export async function describeError(service: string, response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  let detail = body
  try {
    const parsed = JSON.parse(body)
    detail = parsed.error?.message ?? parsed.message ?? parsed.error ?? body
    if (typeof detail !== 'string') detail = JSON.stringify(detail)
  } catch {}
  return `${service} error (${response.status}): ${detail || response.statusText}`
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return []
    const data = await response.json()
    return (data.models ?? []).map((m: { name: string }) => m.name)
  } catch {
    return []
  }
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  ollama: 'Ollama'
}

export function modelFor(settings: Settings, provider: Provider): string {
  switch (provider) {
    case 'openai':
      return settings.openaiModel
    case 'gemini':
      return settings.geminiModel
    case 'groq':
      return settings.groqModel
    case 'mistral':
      return settings.mistralModel
    case 'ollama':
      return settings.ollamaModel
  }
}

export function activeModel(settings: Settings): string {
  return modelFor(settings, settings.provider)
}
