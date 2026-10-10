// Sends a Gemini request across the models a key can use. Each model has its own free-tier quota
// and its own load, so a model that is rate-limited (429) or overloaded (503 "high demand") hands
// over to the next one. When every model is unavailable it throws LimitedError, and the provider
// chain decides whether to move to another provider or wait and retry.
import { describeError } from './providers'
import { checkGeminiKey } from './gemini'
import { busyDelaySeconds, clearBusy, isTransientStatus, LimitedError, parseRetrySeconds, type LimitReason } from './limits'
import type { Settings } from './types'

// Models that can't take requests until a given time, and why — shared by every request in this panel.
const coolingUntil = new Map<string, { until: number; reason: LimitReason }>()
let fetchedModels: { key: string; models: string[] } | null = null

async function candidateModels(settings: Settings): Promise<string[]> {
  let models = settings.geminiModels ?? []
  if (models.length === 0) {
    if (fetchedModels?.key !== settings.geminiKey) {
      const check = await checkGeminiKey(settings.geminiKey)
      fetchedModels = { key: settings.geminiKey, models: check.ok ? check.models : [] }
    }
    models = fetchedModels.models
  }
  // Pro models get little or no free-tier quota, so they're only a last resort.
  const rest = models.filter((m) => m !== settings.geminiModel)
  return [settings.geminiModel, ...rest.filter((m) => !m.includes('pro')), ...rest.filter((m) => m.includes('pro'))]
}

function cool(model: string, seconds: number, reason: LimitReason): void {
  coolingUntil.set(model, { until: Date.now() + seconds * 1000, reason })
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
    if (response.status === 429) {
      const text = await response.text().catch(() => '')
      cool(model, parseRetrySeconds(text) ?? 60, 'rate')
      continue
    }
    if (isTransientStatus(response.status)) {
      cool(model, busyDelaySeconds(`gemini:${model}`), 'busy')
      continue
    }
    // A model this key can't use (retired, or not on this key's plan): try the next one.
    if (response.status === 404 || response.status === 403) {
      unavailable.add(model)
      lastError = await response.text().catch(() => '')
      continue
    }
    throw new Error(await describeError('Gemini', response))
  }

  const waiting = candidates
    .filter((m) => !unavailable.has(m))
    .map((m) => coolingUntil.get(m))
    .filter((c): c is { until: number; reason: LimitReason } => !!c && c.until > Date.now())
    .sort((a, b) => a.until - b.until)
  if (waiting.length > 0) throw new LimitedError('gemini', waiting[0].until, waiting[0].reason)
  throw new Error(`None of the Gemini models this key lists could be used. ${lastError.slice(0, 200)}`)
}
