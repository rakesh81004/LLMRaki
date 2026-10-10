// Turns files the user attaches into something a model can read: text pulled out of documents
// (plain text, code, PDF, Word) or a downsized image. Everything happens in the panel — files
// are never uploaded anywhere except, as part of a message, to the AI provider.
import type { Attachment } from './types'

export const MAX_FILES = 6
const MAX_FILE_BYTES = 15 * 1024 * 1024
// About 10k tokens per file: enough for a résumé, a report or a long code file.
const MAX_TEXT_CHARS = 40_000
// Long side of an attached image after downsizing; plenty for reading text in a screenshot.
const MAX_IMAGE_SIDE = 1600

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'log', 'yaml', 'yml', 'ini', 'toml', 'cfg',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rb', 'php', 'rs',
  'swift', 'sql', 'sh', 'bat', 'ps1', 'css', 'scss', 'less', 'vue', 'svelte', 'r', 'm', 'dart', 'lua', 'pl', 'tex'
]

// What the file picker offers; anything else dropped or pasted is checked the same way.
export const ACCEPT = ['image/*', '.pdf', '.docx', ...TEXT_EXTENSIONS.map((e) => `.${e}`)].join(',')

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function capText(name: string, size: number, mimeType: string, raw: string): Attachment {
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (!text) throw new Error(`“${name}” has no readable text.`)
  return {
    name,
    size,
    mimeType,
    kind: 'text',
    text: text.slice(0, MAX_TEXT_CHARS),
    truncated: text.length > MAX_TEXT_CHARS
  }
}

async function readPdf(file: File): Promise<string> {
  // Loaded only when a PDF is attached, so pdf.js doesn't slow down opening the panel.
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  const pages: string[] = []
  let length = 0
  for (let n = 1; n <= pdf.numPages && length <= MAX_TEXT_CHARS; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      pageText += item.str + (item.hasEOL ? '\n' : ' ')
    }
    pages.push(`[Page ${n}]\n${pageText.trim()}`)
    length += pageText.length
  }
  await task.destroy()
  const text = pages.join('\n\n')
  if (!text.replace(/\[Page \d+\]/g, '').trim()) {
    throw new Error(`“${file.name}” looks like a scanned PDF with no selectable text. Attach it as an image (a screenshot) instead.`)
  }
  return text
}

async function readDocx(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) throw new Error(`“${file.name}” doesn't look like a Word document.`)
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paragraphs: string[] = []
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let line = ''
    for (const node of Array.from(p.getElementsByTagNameNS(W, '*'))) {
      if (node.localName === 't') line += node.textContent ?? ''
      else if (node.localName === 'tab') line += '\t'
      else if (node.localName === 'br') line += '\n'
    }
    paragraphs.push(line)
  }
  return paragraphs.join('\n')
}

async function readImage(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  // Transparent areas become white rather than black once saved as JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name: file.name || 'pasted-image.jpg', size: file.size, mimeType: 'image/jpeg', kind: 'image', data: btoa(binary) }
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`“${file.name}” is ${formatSize(file.size)} — files up to ${formatSize(MAX_FILE_BYTES)} can be attached.`)
  }
  const ext = extensionOf(file.name)
  if (IMAGE_TYPES.includes(file.type) || (file.type.startsWith('image/') && file.type !== 'image/svg+xml')) {
    return readImage(file)
  }
  if (ext === 'pdf' || file.type === 'application/pdf') return capText(file.name, file.size, 'application/pdf', await readPdf(file))
  if (ext === 'docx') return capText(file.name, file.size, file.type, await readDocx(file))
  if (ext === 'doc') throw new Error(`“${file.name}” is an old Word format (.doc). Save it as .docx or PDF and attach that.`)
  if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith('text/') || ext === 'svg') {
    return capText(file.name, file.size, file.type || 'text/plain', await file.text())
  }
  throw new Error(`LLMRaki can't read “${file.name}”. Attach PDF, Word (.docx), text, code or image files.`)
}
