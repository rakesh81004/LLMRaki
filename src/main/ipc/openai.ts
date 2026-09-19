import { ipcMain, BrowserWindow } from 'electron'
import { getDecryptedApiKey, getModel } from './settings'

export interface ChatImage {
  mimeType: string
  data: string
  name?: string
  width?: number
  height?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: ChatImage[]
}

const activeRequests = new Map<string, AbortController>()

function toOpenAiMessages(
  messages: ChatMessage[]
): { role: string; content: string | Array<Record<string, unknown>> }[] {
  return messages.map((m) => {
    if (!m.images || m.images.length === 0) {
      return { role: m.role, content: m.content }
    }
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.data}` }
        }))
      ]
    }
  })
}

async function streamChat(
  win: BrowserWindow,
  requestId: string,
  messages: ChatMessage[]
): Promise<void> {
  const apiKey = await getDecryptedApiKey()
  const channel = (suffix: string) => `ai:${suffix}:${requestId}`

  if (!apiKey) {
    win.webContents.send(channel('error'), 'No OpenAI API key set. Add one in Settings.')
    return
  }

  const model = await getModel()
  const controller = new AbortController()
  activeRequests.set(requestId, controller)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: toOpenAiMessages(messages),
        stream: true
      }),
      signal: controller.signal
    })

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      win.webContents.send(channel('error'), `OpenAI API error (${response.status}): ${text}`)
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
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          win.webContents.send(channel('done'))
          return
        }
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            win.webContents.send(channel('chunk'), delta)
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
      win.webContents.send(channel('error'), message)
    }
  } finally {
    activeRequests.delete(requestId)
  }
}

export function registerAiHandlers(): void {
  // The response streams back over events on ai:chunk:<id> / ai:done:<id> / ai:error:<id>, not the invoke's return value.
  ipcMain.handle('ai:sendMessage', async (event, requestId: string, messages: ChatMessage[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    void streamChat(win, requestId, messages)
  })

  ipcMain.handle('ai:cancel', async (_e, requestId: string) => {
    activeRequests.get(requestId)?.abort()
  })
}
