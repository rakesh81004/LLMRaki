import type { Provider } from './types'

// Why a provider can't take requests for now: its free quota is used up ('rate'), or its servers are
// overloaded or unreachable ('busy' — e.g. Gemini's 503 "model is experiencing high demand").
export type LimitReason = 'rate' | 'busy'

// Thrown when a provider (or every model it offers) can't take requests until a known time,
// so the caller can move on to another provider or wait and retry.
export class LimitedError extends Error {
  constructor(
    public provider: Provider,
    public until: number,
    public reason: LimitReason = 'rate',
    message = `${provider} is ${reason === 'busy' ? 'busy' : 'at its free limit'}`
  ) {
    super(message)
  }
}

// Thrown when a request is bigger than a provider accepts (e.g. Groq's free 8K-tokens-per-minute cap).
export class TooLargeError extends Error {}

export interface RateLimitHooks {
  // Called before waiting, with how long the wait will be and why.
  onWait?: (seconds: number, reason: LimitReason) => void
  // Called with the provider and model that actually answered.
  onAnswer?: (provider: Provider, model: string) => void
}

// Server-side trouble that usually clears up within seconds: worth retrying, not reporting.
export function isTransientStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504 || status === 529
}

// Back-off for a busy model or provider: 5s, 10s, 20s, then 30s while it stays busy.
const busyStreak = new Map<string, number>()
export function busyDelaySeconds(key: string): number {
  const streak = (busyStreak.get(key) ?? 0) + 1
  busyStreak.set(key, streak)
  return Math.min(30, 5 * 2 ** (streak - 1))
}
export function clearBusy(key: string): void {
  busyStreak.delete(key)
}

// Seconds to wait, from a Retry-After header or the wording providers use in their error messages:
// Google "retryDelay": "48s" / "retry in 48.4s"; Groq "try again in 7.66s" / "in 1m2.5s".
export function parseRetrySeconds(text: string, retryAfterHeader?: string | null): number | null {
  if (retryAfterHeader && /^\d+(\.\d+)?$/.test(retryAfterHeader.trim())) {
    return Math.max(1, Math.ceil(parseFloat(retryAfterHeader)))
  }
  const fromDetails = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  if (fromDetails) return Math.max(1, Math.ceil(parseFloat(fromDetails[1])))
  const phrase = text.match(/(?:retry|try again) in (?:(\d+)m)?\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i)
  if (phrase) {
    const minutes = phrase[1] ? parseInt(phrase[1], 10) : 0
    const value = parseFloat(phrase[2])
    const seconds = minutes * 60 + (phrase[3].toLowerCase() === 'ms' ? value / 1000 : value)
    return Math.max(1, Math.ceil(seconds))
  }
  return null
}
