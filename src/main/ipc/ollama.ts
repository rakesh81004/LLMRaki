import { ipcMain, BrowserWindow } from 'electron'
import type { ChatMessage } from './openai'

const OLLAMA_BASE_URL = 'http://localhost:11434'
const activeRequests = new Map<string, AbortController>()

// Ollama's chat API takes raw base64 (no "data:" prefix) in a per-message `images` array.
function toOllamaMessages(
  messages: ChatMessage[]
): { role: string; content: string; images?: string[] }[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.images && m.images.length > 0 ? { images: m.images.map((img) => img.data) } : {})
  }))
}

async function streamOllamaChat(
  win: BrowserWindow,
  requestId: string,
  model: string,
  messages: ChatMessage[]
): Promise<void> {
  const channel = (suffix: string) => `ai:${suffix}:${requestId}`
  const controller = new AbortController()
  activeRequests.set(requestId, controller)

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: toOllamaMessages(messages), stream: true }),
      signal: controller.signal
    })

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      win.webContents.send(
        channel('error'),
        `Ollama error (${response.status}): ${text || 'Is Ollama running? Try "ollama serve".'}`
      )
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          const delta = parsed.message?.content
          if (delta) {
            win.webContents.send(channel('chunk'), delta)
          }
          if (parsed.done) {
            win.webContents.send(channel('done'))
            return
          }
        } catch {}
      }
    }
    win.webContents.send(channel('done'))
  } catch (err) {
    if (controller.signal.aborted) {
      win.webContents.send(channel('done'))
    } else {
      const message = err instanceof Error ? err.message : String(err)
      const hint = message.includes('fetch failed')
        ? `Could not reach Ollama at ${OLLAMA_BASE_URL}. Is it running? Try "ollama serve" in a terminal.`
        : message
      win.webContents.send(channel('error'), hint)
    }
  } finally {
    activeRequests.delete(requestId)
  }
}

export function registerOllamaHandlers(): void {
  ipcMain.handle(
    'ollama:sendMessage',
    async (event, requestId: string, model: string, messages: ChatMessage[]) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      void streamOllamaChat(win, requestId, model, messages)
    }
  )

  ipcMain.handle('ollama:cancel', async (_e, requestId: string) => {
    activeRequests.get(requestId)?.abort()
  })

  ipcMain.handle('ollama:listModels', async (): Promise<string[]> => {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
      if (!response.ok) return []
      const data = await response.json()
      return (data.models ?? []).map((m: { name: string }) => m.name)
    } catch {
      return []
    }
  })
}
