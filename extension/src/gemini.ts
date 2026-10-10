// Checks a Gemini API key against Google and finds the chat models it can use.

const NON_CHAT_MODEL_RE = /-tts|-image|-audio|-live|computer-use|embedding|aqa|imagen|veo/i

export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey'

export type KeyCheck = { ok: true; models: string[] } | { ok: false; error: string }

export async function checkGeminiKey(apiKey: string): Promise<KeyCheck> {
  if (!apiKey.trim()) return { ok: false, error: 'Paste your Gemini API key first.' }
  let response: Response
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': apiKey.trim() },
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, error: "Couldn't reach Google. Check your internet connection and try again." }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) {
      return { ok: false, error: "That key isn't valid. Copy it again from Google AI Studio — it starts with “AIza”." }
    }
    if (response.status === 403) {
      return { ok: false, error: "Google refused this key. Make sure it's a Gemini API key from Google AI Studio and that it hasn't been restricted." }
    }
    if (response.status === 429) return { ok: false, error: 'Google says this key is over its limit right now. Wait a minute and try again.' }
    return { ok: false, error: `Google returned an error (${response.status}). Try again in a moment.` }
  }
  const data = await response.json()
  const models: string[] = (data.models ?? [])
    .filter(
      (m: { name?: string; supportedGenerationMethods?: string[] }) =>
        /^models\/gemini-\d/i.test(String(m.name)) &&
        !NON_CHAT_MODEL_RE.test(String(m.name)) &&
        (m.supportedGenerationMethods ?? []).includes('generateContent')
    )
    .map((m: { name: string }) => m.name.replace(/^models\//, ''))
    .sort((a: string, b: string) => rankModel(b) - rankModel(a))
  if (models.length === 0) return { ok: false, error: "This key works, but it doesn't have access to any Gemini chat models." }
  return { ok: true, models }
}

// Newer versions first; within a version prefer Flash (fast, generous free tier) over Pro and Lite.
function rankModel(id: string): number {
  const versionMatch = id.match(/^gemini-(\d+(?:\.\d+)?)/)
  const version = versionMatch ? parseFloat(versionMatch[1]) : 0
  let tier = 1
  if (id.includes('flash-lite')) tier = 1
  else if (id.includes('flash')) tier = 3
  else if (id.includes('pro')) tier = 2
  const experimentalPenalty = /(exp|preview|thinking)/.test(id) ? -0.5 : 0
  return version * 10 + tier + experimentalPenalty
}

export function pickModel(models: string[], preferred: string): string {
  return models.includes(preferred) ? preferred : models[0]
}
