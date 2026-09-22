import { ipcMain } from 'electron'
import {
  getDecryptedApiKey,
  getModel,
  getProvider,
  getOllamaModel,
  getDecryptedGeminiKey,
  getGeminiModel
} from './settings'

interface SimpleMessage {
  role: 'system' | 'user'
  content: string
}

// Single-shot (non-streaming) completions for the two inline-editor features — Tab ghost-text
// and the Cmd+K edit popup — deliberately kept separate from the chat/agent pipelines in
// openai.ts/ollama.ts/gemini.ts, which stream and (for Gemini) run a whole tool-use agent loop.
// Both inline features need one plain string back, as fast as possible, regardless of which
// provider chat is currently configured to use.
async function completeOnce(
  messages: SimpleMessage[],
  maxTokens: number,
  signal: AbortSignal
): Promise<string> {
  const provider = await getProvider()

  if (provider === 'openai') {
    const apiKey = await getDecryptedApiKey()
    if (!apiKey) throw new Error('No OpenAI API key set. Add one in Settings.')
    const model = await getModel()
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false
      }),
      signal
    })
    if (!response.ok) {
      throw new Error(`OpenAI error (${response.status}): ${await response.text().catch(() => '')}`)
    }
    const data = await response.json()
    return data.choices?.[0]?.message?.content ?? ''
  }

  if (provider === 'gemini') {
    const apiKey = await getDecryptedGeminiKey()
    if (!apiKey) throw new Error('No Gemini API key set. Add one in Settings.')
    const model = await getGeminiModel()
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }))
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: 'user', parts: [{ text: m.content }] }))
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 }
    }
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts }
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
    )
    if (!response.ok) {
      throw new Error(`Gemini error (${response.status}): ${await response.text().catch(() => '')}`)
    }
    const data = await response.json()
    const parts = data.candidates?.[0]?.content?.parts ?? []
    return parts.map((p: { text?: string }) => p.text ?? '').join('')
  }

  // Ollama
  const model = await getOllamaModel()
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.2, num_predict: maxTokens }
    }),
    signal
  })
  if (!response.ok) {
    throw new Error(
      `Ollama error (${response.status}): ${await response.text().catch(() => 'Is Ollama running?')}`
    )
  }
  const data = await response.json()
  return data.message?.content ?? ''
}

// Models routinely wrap "just the code" answers in a markdown fence despite instructions not to.
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[a-zA-Z0-9_+-]*\n([\s\S]*?)\n?```$/)
  return match ? match[1] : trimmed
}

interface CompletionPayload {
  prefix: string
  suffix: string
  language: string
}

function buildCompletionMessages(payload: CompletionPayload): SimpleMessage[] {
  return [
    {
      role: 'system',
      content:
        `You are a code completion engine for a ${payload.language} file. ` +
        'Continue the code exactly where the cursor is. ' +
        'Reply with ONLY the raw code to insert — no explanations, no markdown fences, no repeating existing code. ' +
        'Keep it short: usually a single line or a few lines. If nothing sensible continues the code, reply with an empty string.'
    },
    {
      role: 'user',
      content: `Code before cursor:\n${payload.prefix}\n<CURSOR>\nCode after cursor:\n${payload.suffix}`
    }
  ]
}

interface EditPayload {
  code: string
  instruction: string
  language: string
  fileName: string
}

function buildEditMessages(payload: EditPayload): SimpleMessage[] {
  return [
    {
      role: 'system',
      content:
        `You are an in-editor AI code editor for a ${payload.language} file named ${payload.fileName}. ` +
        'The user selected some code and gave an instruction for how to change it. ' +
        'Reply with ONLY the full replacement code for the selection — no explanations, no markdown fences, ' +
        'no commentary before or after. Preserve indentation style. If the instruction implies adding new code ' +
        'at this location, include the original code plus the addition as appropriate.'
    },
    {
      role: 'user',
      content: `Instruction: ${payload.instruction}\n\nSelected code:\n${payload.code}`
    }
  ]
}

// Only the latest ghost-text request matters — superseding it aborts the in-flight fetch so a
// slow provider response from three keystrokes ago never overwrites what's currently on screen.
let currentCompletionAbort: AbortController | null = null

export function registerInlineAiHandlers(): void {
  ipcMain.handle('inlineai:complete', async (_e, payload: CompletionPayload): Promise<string | null> => {
    currentCompletionAbort?.abort()
    const controller = new AbortController()
    currentCompletionAbort = controller
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const raw = await completeOnce(buildCompletionMessages(payload), 200, controller.signal)
      const cleaned = stripCodeFence(raw)
      return cleaned.length > 0 ? cleaned : null
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
      if (currentCompletionAbort === controller) currentCompletionAbort = null
    }
  })

  ipcMain.handle('inlineai:edit', async (_e, payload: EditPayload): Promise<string> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    try {
      const raw = await completeOnce(buildEditMessages(payload), 4000, controller.signal)
      return stripCodeFence(raw)
    } finally {
      clearTimeout(timeout)
    }
  })
}
