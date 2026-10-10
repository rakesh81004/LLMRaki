// Talks to the AI providers. Requests go through a chain — the main provider first, then any other
// free provider with a key (Gemini → Groq → Mistral) — so one provider's rate limit or overload hands
// the request to the next instead of stopping. Only when every provider is unavailable does it wait,
// using the providers' own retry times (or a short back-off when a server is just busy).
import { geminiRequest } from './geminiRequest'
import {
  busyDelaySeconds,
  clearBusy,
  isTransientStatus,
  LimitedError,
  parseRetrySeconds,
  TooLargeError,
  type LimitReason,
  type RateLimitHooks
} from './limits'
import {
  describeError,
  modelFor,
  OLLAMA_BASE_URL,
  OLLAMA_UNREACHABLE,
  PROVIDER_LABELS,
  toWireMessages,
  type WireImage,
  type WireMessage
} from './providers'
import type { ChatMessage, Provider, Settings } from './types'

export type { RateLimitHooks } from './limits'

// Per-minute limits reset within a minute or so; anything longer is a daily limit, not worth waiting out.
const MAX_WAIT_SECONDS = 90
// Enough rounds to ride out a minute or two of "high demand" (back-off 5s, 10s, 20s, 30s…) before giving up.
const MAX_WAIT_ROUNDS = 7

const BACKUP_ORDER: Provider[] = ['gemini', 'groq', 'mistral']

// OpenAI, Groq and Mistral all speak the OpenAI chat-completions format.
type CompatProvider = 'openai' | 'groq' | 'mistral'
const COMPAT: Record<CompatProvider, { url: string; key: (s: Settings) => string }> = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', key: (s) => s.openaiKey },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: (s) => s.groqKey },
  mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: (s) => s.mistralKey }
}

function hasKey(settings: Settings, provider: Provider): boolean {
  if (provider === 'gemini') return !!settings.geminiKey
  if (provider === 'ollama') return true
  return !!COMPAT[provider].key(settings)
}

export function providerChain(settings: Settings): Provider[] {
  const chain: Provider[] = [settings.provider]
  if (settings.fallback !== false) {
    for (const p of BACKUP_ORDER) if (p !== settings.provider && hasKey(settings, p)) chain.push(p)
  }
  return chain
}

// Providers (other than Gemini, which tracks this per model) that can't take requests until a given time.
const coolingUntil = new Map<Provider, { until: number; reason: LimitReason }>()

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

function limitHelp(chain: Provider[]): string {
  const missing = BACKUP_ORDER.filter((p) => !chain.includes(p)).map((p) => PROVIDER_LABELS[p])
  return missing.length > 0
    ? `Add free ${missing.join(' and ')} keys in Settings so LLMRaki can switch to them instead of stopping.`
    : 'Turning on billing with any of these providers lifts the free limits.'
}

async function runChain<T>(
  settings: Settings,
  signal: AbortSignal,
  hooks: RateLimitHooks,
  attempt: (provider: Provider) => Promise<T>
): Promise<T> {
  const chain = providerChain(settings)
  let lastReason: LimitReason = 'rate'
  for (let round = 0; round <= MAX_WAIT_ROUNDS; round++) {
    const unavailable: { until: number; reason: LimitReason }[] = []
    const errors: string[] = []
    for (const provider of chain) {
      const cooling = coolingUntil.get(provider)
      if (cooling && cooling.until > Date.now()) {
        unavailable.push(cooling)
        continue
      }
      try {
        return await attempt(provider)
      } catch (err) {
        if (signal.aborted) throw err
        if (err instanceof LimitedError) {
          const entry = { until: err.until, reason: err.reason }
          if (provider !== 'gemini') coolingUntil.set(provider, entry)
          unavailable.push(entry)
          continue
        }
        // With nothing to fall back to, keep the provider's own, specific error.
        if (chain.length === 1) throw err
        errors.push(`${PROVIDER_LABELS[provider]}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (unavailable.length === 0) {
      throw new Error(errors.length === 1 ? errors[0] : `None of your AI providers could answer:\n${errors.join('\n')}`)
    }
    const soonest = unavailable.sort((a, b) => a.until - b.until)[0]
    lastReason = soonest.reason
    const seconds = Math.max(1, Math.ceil((soonest.until - Date.now()) / 1000))
    if (seconds > MAX_WAIT_SECONDS && soonest.reason === 'rate') {
      const names = chain.map((p) => PROVIDER_LABELS[p]).join(', ')
      throw new Error(`The free daily limit is used up on ${names}. ${limitHelp(chain)}`)
    }
    if (round === MAX_WAIT_ROUNDS) break
    hooks.onWait?.(seconds, soonest.reason)
    await sleep(seconds * 1000, signal)
  }
  throw new Error(
    lastReason === 'busy'
      ? `${chain.map((p) => PROVIDER_LABELS[p]).join(' and ')} stayed overloaded for a couple of minutes. Send your message again in a little while. ${limitHelp(chain)}`
      : `Still at the free limit after several waits. ${limitHelp(chain)}`
  )
}

// Sends an OpenAI-format request to OpenAI, Groq or Mistral, turning rate limits into LimitedError
// and oversized requests into TooLargeError so the chain can move on.
async function compatFetch(provider: CompatProvider, settings: Settings, body: object, signal: AbortSignal): Promise<Response> {
  const key = COMPAT[provider].key(settings)
  if (!key) throw new Error(`No ${PROVIDER_LABELS[provider]} API key set. Add one in Settings.`)
  let response: Response
  try {
    response = await fetch(COMPAT[provider].url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelFor(settings, provider), ...body }),
      signal
    })
  } catch (err) {
    if (signal.aborted) throw err
    // A dropped connection: treat like a busy server and retry shortly.
    throw new LimitedError(provider, Date.now() + busyDelaySeconds(provider) * 1000, 'busy')
  }
  if (response.ok) {
    clearBusy(provider)
    return response
  }
  const text = await response.clone().text().catch(() => '')
  if (response.status === 413 || /request too large|context.length|maximum context|too many tokens/i.test(text)) {
    throw new TooLargeError(`${PROVIDER_LABELS[provider]} can't take a request this large on its free tier.`)
  }
  if (response.status === 429) {
    const seconds = parseRetrySeconds(text, response.headers.get('retry-after')) ?? 30
    throw new LimitedError(provider, Date.now() + seconds * 1000, 'rate')
  }
  if (isTransientStatus(response.status)) {
    throw new LimitedError(provider, Date.now() + busyDelaySeconds(provider) * 1000, 'busy')
  }
  throw new Error(await describeError(PROVIDER_LABELS[provider], response))
}

async function* readLines(response: Response): AsyncGenerator<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) yield line
  }
  if (buffer) yield buffer
}

async function ollamaFetch(path: string, body: object, signal: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${OLLAMA_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    if (signal.aborted) throw err
    throw new Error(OLLAMA_UNREACHABLE)
  }
  // Ollama refuses requests from origins it doesn't recognise, and browser extensions aren't on its default list.
  if (response.status === 403) {
    throw new Error(
      'Ollama blocked the request from this extension. Set the environment variable OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.'
    )
  }
  return response
}

// ---- Attached images, in each provider's format ----

// Whether the provider's configured model can look at images. Groq's default models are text-only;
// a request with images skips such a provider and moves along the chain.
function supportsImages(provider: Provider, settings: Settings): boolean {
  const model = modelFor(settings, provider).toLowerCase()
  if (provider === 'groq') return /llama-4|vision|scout|maverick/.test(model)
  if (provider === 'mistral') return /small|medium|large|pixtral|ministral/.test(model)
  return true
}

function requireImageSupport(provider: Provider, settings: Settings, hasImages: boolean): void {
  if (hasImages && !supportsImages(provider, settings)) {
    throw new Error(`${PROVIDER_LABELS[provider]} (${modelFor(settings, provider)}) can't look at images.`)
  }
}

function geminiUserParts(text: string, images?: WireImage[]): Record<string, unknown>[] {
  return [...(images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text }]
}

function compatUserMessage(provider: Provider, text: string, images?: WireImage[]): Record<string, unknown> {
  if (!images?.length) return { role: 'user', content: text }
  if (provider === 'ollama') return { role: 'user', content: text, images: images.map((i) => i.data) }
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((i) => {
        const url = `data:${i.mimeType};base64,${i.data}`
        // Mistral takes the data URL as a plain string; OpenAI and Groq wrap it in an object.
        return { type: 'image_url', image_url: provider === 'mistral' ? url : { url } }
      })
    ]
  }
}

function compatWire(provider: Provider, wire: WireMessage[]): Record<string, unknown>[] {
  return wire.map((m) => (m.role === 'user' ? compatUserMessage(provider, m.content, m.images) : { role: m.role, content: m.content }))
}

// ---- Streaming chat (Ask mode) ----

// Opens the stream (so rate limits surface before any text arrives) and returns its text chunks.
async function openStream(
  provider: Provider,
  settings: Settings,
  wire: WireMessage[],
  signal: AbortSignal,
  hooks: RateLimitHooks
): Promise<AsyncGenerator<string>> {
  requireImageSupport(provider, settings, wire.some((m) => m.images?.length))
  if (provider === 'gemini') {
    const system = wire.filter((m) => m.role === 'system').map((m) => ({ text: m.content }))
    const contents = wire
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.role === 'assistant' ? { role: 'model', parts: [{ text: m.content }] } : { role: 'user', parts: geminiUserParts(m.content, m.images) }
      )
    const { response, model } = await geminiRequest(
      settings,
      (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`,
      { systemInstruction: { parts: system }, contents },
      signal
    )
    hooks.onAnswer?.('gemini', model)
    return (async function* () {
      for await (const line of readLines(response)) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        try {
          const parts = JSON.parse(trimmed.slice(5)).candidates?.[0]?.content?.parts ?? []
          for (const part of parts) if (typeof part.text === 'string' && !part.thought) yield part.text
        } catch {}
      }
    })()
  }

  if (provider === 'ollama') {
    const response = await ollamaFetch('/api/chat', { model: settings.ollamaModel, messages: compatWire('ollama', wire), stream: true }, signal)
    if (!response.ok || !response.body) throw new Error(await describeError('Ollama', response))
    hooks.onAnswer?.('ollama', settings.ollamaModel)
    return (async function* () {
      for await (const line of readLines(response)) {
        if (!line.trim()) continue
        let parsed: { error?: string; message?: { content?: string }; done?: boolean }
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (parsed.error) throw new Error(`Ollama error: ${parsed.error}`)
        if (parsed.message?.content) yield parsed.message.content
        if (parsed.done) return
      }
    })()
  }

  const response = await compatFetch(provider, settings, { messages: compatWire(provider, wire), stream: true }, signal)
  hooks.onAnswer?.(provider, modelFor(settings, provider))
  return (async function* () {
    for await (const line of readLines(response)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {}
    }
  })()
}

export async function* streamChat(
  settings: Settings,
  messages: ChatMessage[],
  signal: AbortSignal,
  hooks: RateLimitHooks = {}
): AsyncGenerator<string> {
  const wire = toWireMessages(messages)
  const stream = await runChain(settings, signal, hooks, (provider) => openStream(provider, settings, wire, signal, hooks))
  yield* stream
}

// ---- Tool calling (Edit / Auto mode) ----

export interface ToolCall {
  // LLMRaki's own id (9 letters/digits, which every provider accepts); providerId is Gemini's, if it gave one.
  id: string
  providerId?: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  call: ToolCall
  output: string
}

// A provider-neutral record of the agent's conversation, so a run can move between providers.
export type Turn =
  | { role: 'user'; text: string; images?: WireImage[] }
  | { role: 'assistant'; text: string; calls: ToolCall[]; gemini?: { model: string; parts: Record<string, unknown>[] } }
  | { role: 'tool'; results: ToolResult[] }

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

function newCallId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = ''
  for (let i = 0; i < 9; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json || '{}')
  } catch {
    return {}
  }
}

// Tool results that carry a page snapshot start with (or contain) these labels, so they can be found
// without relying on the snapshot's JSON shape (Chrome may reorder its keys).
export const SNAPSHOT_LABEL = 'Page snapshot: '
export const AFTER_ACTION_LABEL = 'The page now: '

function hasSnapshot(output: string): boolean {
  return output.startsWith(SNAPSHOT_LABEL) || output.includes(AFTER_ACTION_LABEL)
}

// Page snapshots are by far the largest part of a run. Only the latest one matters for the next
// step, so older ones are replaced with a short note — this keeps requests within free-tier size
// caps (Groq's is 8K tokens a minute) and saves quota everywhere.
function compactTurns(turns: Turn[]): Turn[] {
  let lastSnapshot = -1
  turns.forEach((t, i) => {
    if (t.role === 'tool' && t.results.some((r) => hasSnapshot(r.output))) lastSnapshot = i
  })
  return turns.map((t, i) =>
    t.role === 'tool' && i < lastSnapshot
      ? {
          ...t,
          results: t.results.map((r) => ({
            ...r,
            output: r.output.startsWith(SNAPSHOT_LABEL)
              ? '[Older page snapshot removed to save space — use the latest one.]'
              : r.output.includes(AFTER_ACTION_LABEL)
                ? r.output.slice(0, r.output.indexOf(AFTER_ACTION_LABEL)) + '[The page changed afterwards; see the latest snapshot.]'
                : r.output
          }))
        }
      : t
  )
}

// Google documents this value for replaying tool-call turns that came from a different model or provider.
const SKIP_SIGNATURE_CHECK = 'skip_thought_signature_validator'

function geminiContents(turns: Turn[], model: string): Record<string, unknown>[] {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', parts: geminiUserParts(t.text, t.images) }
    if (t.role === 'tool') {
      return {
        role: 'user',
        parts: t.results.map((r) => ({
          functionResponse: {
            ...(r.call.providerId ? { id: r.call.providerId } : {}),
            name: r.call.name,
            response: { result: r.output }
          }
        }))
      }
    }
    if (t.gemini) {
      // Gemini's own turn: replay it as given; its signatures are only valid for the model that wrote them.
      const parts =
        t.gemini.model === model
          ? t.gemini.parts
          : t.gemini.parts.map((p) => (p.thoughtSignature ? { ...p, thoughtSignature: SKIP_SIGNATURE_CHECK } : p))
      return { role: 'model', parts }
    }
    return {
      role: 'model',
      parts: [
        ...(t.text ? [{ text: t.text }] : []),
        ...t.calls.map((c) => ({ functionCall: { name: c.name, args: c.args }, thoughtSignature: SKIP_SIGNATURE_CHECK }))
      ]
    }
  })
}

function compatMessages(provider: Provider, system: string, turns: Turn[]): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: system }]
  for (const t of turns) {
    if (t.role === 'user') messages.push(compatUserMessage(provider, t.text, t.images))
    else if (t.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: t.text,
        ...(t.calls.length > 0
          ? {
              tool_calls: t.calls.map((c) =>
                provider === 'ollama'
                  ? { function: { name: c.name, arguments: c.args } }
                  : { id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }
              )
            }
          : {})
      })
    } else {
      for (const r of t.results) {
        if (provider === 'ollama') messages.push({ role: 'tool', tool_name: r.call.name, content: r.output })
        // Mistral wants the tool's name on its result; Groq rejects a name field on messages.
        else messages.push({ role: 'tool', tool_call_id: r.call.id, content: r.output, ...(provider === 'mistral' ? { name: r.call.name } : {}) })
      }
    }
  }
  return messages
}

async function callOnce(
  provider: Provider,
  settings: Settings,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  signal: AbortSignal,
  hooks: RateLimitHooks
): Promise<Extract<Turn, { role: 'assistant' }>> {
  const compact = compactTurns(turns)
  requireImageSupport(provider, settings, turns.some((t) => t.role === 'user' && !!t.images?.length))

  if (provider === 'gemini') {
    const { response, model } = await geminiRequest(
      settings,
      (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
      (m: string) => ({
        systemInstruction: { parts: [{ text: system }] },
        contents: geminiContents(compact, m),
        tools: [{ functionDeclarations: tools }]
      }),
      signal
    )
    const content = (await response.json()).candidates?.[0]?.content
    if (!content) throw new Error('Gemini returned no answer. Try rephrasing the request.')
    hooks.onAnswer?.('gemini', model)
    const parts: Record<string, unknown>[] = content.parts ?? []
    return {
      role: 'assistant',
      text: parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join(''),
      calls: parts
        .filter((p) => p.functionCall)
        .map((p) => {
          const fc = p.functionCall as { id?: string; name: string; args?: Record<string, unknown> }
          return { id: newCallId(), providerId: fc.id, name: fc.name, args: fc.args ?? {} }
        }),
      gemini: { model, parts }
    }
  }

  const toolSpecs = tools.map((t) => ({ type: 'function', function: t }))
  let message: { content?: string | null; tool_calls?: { function: { name: string; arguments: string | Record<string, unknown> } }[] }
  if (provider === 'ollama') {
    const response = await ollamaFetch(
      '/api/chat',
      { model: settings.ollamaModel, messages: compatMessages('ollama', system, compact), tools: toolSpecs, stream: false },
      signal
    )
    if (!response.ok) {
      const error = await describeError('Ollama', response)
      if (/does not support tools/i.test(error)) {
        throw new Error(
          `${settings.ollamaModel} can't use page actions. Pick a model with tool support (for example llama3.2 or qwen2.5) in Settings, or use Ask mode.`
        )
      }
      throw new Error(error)
    }
    message = (await response.json()).message ?? {}
  } else {
    const response = await compatFetch(provider, settings, { messages: compatMessages(provider, system, compact), tools: toolSpecs }, signal)
    message = (await response.json()).choices?.[0]?.message ?? {}
  }
  hooks.onAnswer?.(provider, modelFor(settings, provider))
  return {
    role: 'assistant',
    text: message.content ?? '',
    calls: (message.tool_calls ?? []).map((c) => ({
      id: newCallId(),
      name: c.function.name,
      args: typeof c.function.arguments === 'string' ? safeParse(c.function.arguments) : (c.function.arguments ?? {})
    }))
  }
}

export function callWithTools(
  settings: Settings,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  signal: AbortSignal,
  hooks: RateLimitHooks = {}
): Promise<Extract<Turn, { role: 'assistant' }>> {
  return runChain(settings, signal, hooks, (provider) => callOnce(provider, settings, system, turns, tools, signal, hooks))
}

export function wireToTurns(wire: WireMessage[]): Turn[] {
  return wire
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'user' ? { role: 'user', text: m.content, images: m.images } : { role: 'assistant', text: m.content, calls: [] }))
}

// ---- Key checks for the OpenAI-format providers ----

export type CompatKeyCheck = { ok: true; models: string[] } | { ok: false; error: string }

const MODEL_LIST_URL: Record<'groq' | 'mistral', string> = {
  groq: 'https://api.groq.com/openai/v1/models',
  mistral: 'https://api.mistral.ai/v1/models'
}

export async function checkCompatKey(provider: 'groq' | 'mistral', key: string): Promise<CompatKeyCheck> {
  if (!key.trim()) return { ok: false, error: 'Paste the key first.' }
  let response: Response
  try {
    response = await fetch(MODEL_LIST_URL[provider], {
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, error: `Couldn't reach ${PROVIDER_LABELS[provider]}. Check your internet connection.` }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: `${PROVIDER_LABELS[provider]} says this key isn't valid. Copy it again from its console.` }
  }
  if (!response.ok) return { ok: false, error: `${PROVIDER_LABELS[provider]} returned an error (${response.status}). Try again in a moment.` }
  const data = await response.json()
  const models: string[] = (data.data ?? [])
    .filter((m: { id: string; capabilities?: { function_calling?: boolean } }) =>
      provider === 'mistral'
        ? m.capabilities?.function_calling !== false
        : !/whisper|guard|orpheus|tts|distil/i.test(m.id)
    )
    .map((m: { id: string }) => m.id)
  return { ok: true, models }
}

export const PREFERRED_MODELS: Record<'groq' | 'mistral', string[]> = {
  groq: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  mistral: ['mistral-small-latest', 'mistral-medium-latest', 'ministral-8b-latest']
}

export function pickCompatModel(provider: 'groq' | 'mistral', models: string[], current: string): string {
  if (models.includes(current)) return current
  return PREFERRED_MODELS[provider].find((m) => models.includes(m)) ?? models[0] ?? current
}
