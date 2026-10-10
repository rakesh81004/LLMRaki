export type Provider = 'openai' | 'gemini' | 'groq' | 'mistral' | 'ollama'

// Ask: chat only. Edit: fills fields directly, asks before every click. Auto: fills and clicks
// on its own, asking only before clicks that submit, send, pay or delete.
export type Mode = 'ask' | 'edit' | 'auto'

export interface Settings {
  mode: Mode
  provider: Provider
  // Set once the user picks a provider themselves (Settings or first-time setup).
  providerChosen?: boolean
  openaiKey: string
  openaiModel: string
  geminiKey: string
  geminiModel: string
  // Chat models the key can use, best first — fallbacks when the chosen model hits its rate limit.
  geminiModels?: string[]
  groqKey: string
  groqModel: string
  mistralKey: string
  mistralModel: string
  ollamaModel: string
  // When the main provider is at its limit, carry on with the other free providers that have a key.
  fallback: boolean
  // Alerts when LLMRaki needs an Allow/Deny, finishes, or stops on an error.
  sound: boolean
  notifications: boolean
}

// Gemini by default: it needs only a free key, while Ollama has to be installed and running locally.
// Groq and Mistral have free tiers too, so they serve as automatic backups once their keys are added.
export const DEFAULT_SETTINGS: Settings = {
  mode: 'ask',
  provider: 'gemini',
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  geminiKey: '',
  geminiModel: 'gemini-3.6-flash',
  groqKey: '',
  groqModel: 'openai/gpt-oss-120b',
  mistralKey: '',
  mistralModel: 'mistral-small-latest',
  ollamaModel: 'llama3.2',
  fallback: true,
  sound: true,
  notifications: true
}

export interface PageContext {
  title: string
  url: string
  // 'selection' when the user had text highlighted, otherwise the page's visible text.
  kind: 'selection' | 'page'
  text: string
  truncated: boolean
}

export interface AgentStep {
  id: string
  kind: 'read' | 'fill' | 'click' | 'navigate'
  label: string
  detail?: string
  status: 'running' | 'awaiting' | 'done' | 'denied' | 'failed' | 'undone'
  error?: string
  // Enough to put a filled field back the way it was.
  undo?: { tabId: number; ref: string; value: string }
}

// A file attached to a message: documents are kept as their extracted text, images as base64 JPEG.
export interface Attachment {
  name: string
  size: number
  mimeType: string
  kind: 'text' | 'image'
  text?: string
  truncated?: boolean
  data?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  // Snapshotted when the message is sent, so switching modes later doesn't recolour past messages.
  mode?: Mode
  page?: PageContext
  steps?: AgentStep[]
  error?: boolean
  // Shown under the reply, e.g. which model answered after a rate limit.
  note?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}
