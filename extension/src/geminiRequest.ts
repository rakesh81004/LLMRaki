// Sends a Gemini request across the models a key can use. Each model has its own free-tier quota
// and its own load, so a model that is rate-limited (429) or overloaded (503 "high demand") hands
// over to the next one. A model that can't do this kind of request at all (e.g. "Multiturn chat is
// not enabled for this model") is skipped and remembered, so it isn't tried again. When every model
// is unavailable it throws LimitedError, and the provider chain decides whether to move to another
// provider or wait and retry.
import { checkGeminiKey } from './gemini'
import { busyDelaySeconds, clearBusy, isTransientStatus, LimitedError, parseRetrySeconds, type LimitReason } from './limits'
import type { Settings } from './types'

// Models that can't take requests until a given time, and why — shared by every request in this panel.
const coolingUntil = new Map<string, { until: number; reason: LimitReason }>()
let fetchedModels: { key: string; models: string[] } | null = null

// Models found unable to chat or use tools, kept for a week (Google may enable them later).
const SKIP_KEY = 'geminiSkippedModels'
const SKIP_DAYS = 7
type SkipList = Record<string, { reason: string; until: number }>

async function skippedModels(): Promise<SkipList> {
  const stored = await chrome.storage.local.get(SKIP_KEY).catch(() => ({}) as Record<string, unknown>)
  const list = (stored[SKIP_KEY] as SkipList | undefined) ?? {}
  return Object.fromEntries(Object.entries(list).filter(([, v]) => v.until > Date.now()))
}

async function skipModel(model: string, reason: string): Promise<void> {
  const list = await skippedModels()
  list[model] = { reason: reason.slice(0, 200), until: Date.now() + SKIP_DAYS * 24 * 3600 * 1000 }
  await chrome.storage.local.set({ [SKIP_KEY]: list }).catch(() => {})
}

// A 400 that says the model can't do this kind of request, as opposed to a mistake in the request.
const INCAPABLE =
  /not (enabled|supported|available)|does not support|doesn't support|unsupported|multi-?turn|function calling|tool (use|calling)|only supports|is not a (chat|generative)/i

function versionOf(model: string): number {
  const match = model.match(/^gemini-(\d+(?:\.\d+)?)/)
  return match ? parseFloat(match[1]) : 0
}

const EXPERIMENTAL = /(preview|exp|experimental|thinking|-latest-?$|\d{2}-\d{2})/i

// Fallback order when the chosen model can't answer: steady models first — the same version or
// older, newest of those first — then newer or experimental ones, and Pro (little free quota) last.
// Newer models are often limited previews that can't yet hold a conversation or use tools.
async function candidateModels(settings: Settings): Promise<string[]> {
  let models = settings.geminiModels ?? []
  if (models.length === 0) {
    if (fetchedModels?.key !== settings.geminiKey) {
      const check = await checkGeminiKey(settings.geminiKey)
      fetchedModels = { key: settings.geminiKey, models: check.ok ? check.models : [] }
    }
    models = fetchedModels.models
  }
  const skipped = await skippedModels()
  const chosen = settings.geminiModel
  const chosenVersion = versionOf(chosen) || Infinity
  const rest = models.filter((m) => m !== chosen && !skipped[m])
  const steady = rest
    .filter((m) => !m.includes('pro') && !EXPERIMENTAL.test(m) && versionOf(m) <= chosenVersion)
    .sort((a, b) => versionOf(b) - versionOf(a))
  const other = rest.filter((m) => !m.includes('pro') && !steady.includes(m))
  const pro = rest.filter((m) => m.includes('pro'))
  return [...(skipped[chosen] ? [] : [chosen]), ...steady, ...other, ...pro]
}

function cool(model: string, seconds: number, reason: LimitReason): void {
  coolingUntil.set(model, { until: Date.now() + seconds * 1000, reason })
}

function errorMessage(text: string): string {
  try {
    return JSON.parse(text).error?.message ?? text
  } catch {
    return text
  }
}

export async function geminiRequest(
  settings: Settings,
  makeUrl: (model: string) => string,
  // A function when the body depends on which model is being tried.
  body: unknown | ((model: string) => unknown),
  signal: AbortSignal
): Promise<{ response: Response; model: string }> {
  if (!settings.geminiKey) throw new Error('No Gemini API key set. Add one in Settings.')
  const candidates = await candidateModels(settings)
  const unavailable = new Set<string>()
  let lastError = ''

  for (const model of candidates) {
    if ((coolingUntil.get(model)?.until ?? 0) > Date.now()) continue
    let response: Response
    try {
      response = await fetch(makeUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
        body: JSON.stringify(typeof body === 'function' ? body(model) : body),
        signal
      })
    } catch (err) {
      if (signal.aborted) throw err
      // A dropped connection: treat like a busy server and retry shortly.
      cool(model, busyDelaySeconds(`gemini:${model}`), 'busy')
      continue
    }
    if (response.ok) {
      clearBusy(`gemini:${model}`)
      return { response, model }
    }
    const text = await response.text().catch(() => '')
    if (response.status === 429) {
      cool(model, parseRetrySeconds(text) ?? 60, 'rate')
      continue
    }
    if (isTransientStatus(response.status)) {
      cool(model, busyDelaySeconds(`gemini:${model}`), 'busy')
      continue
    }
    // A model this key can't use (retired, or not on this key's plan), or one that can't do this
    // kind of request: try the next one, and don't try this one again for a while.
    if (response.status === 404 || response.status === 403 || (response.status === 400 && INCAPABLE.test(text))) {
      unavailable.add(model)
      lastError = errorMessage(text)
      await skipModel(model, lastError)
      continue
    }
    throw new Error(`Gemini error (${response.status}): ${errorMessage(text) || response.statusText}`)
  }

  const waiting = candidates
    .filter((m) => !unavailable.has(m))
    .map((m) => coolingUntil.get(m))
    .filter((c): c is { until: number; reason: LimitReason } => !!c && c.until > Date.now())
    .sort((a, b) => a.until - b.until)
  if (waiting.length > 0) throw new LimitedError('gemini', waiting[0].until, waiting[0].reason)
  throw new Error(
    `None of the Gemini models available to this key could take this request${lastError ? ` (last reason: ${lastError.slice(0, 160)})` : ''}. ` +
      'Pick a different Gemini model in Settings, or add the free Groq or Mistral backups.'
  )
}
