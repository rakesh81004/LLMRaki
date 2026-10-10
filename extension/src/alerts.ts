// Sound and system notifications for the moments that need the user: LLMRaki is waiting for an
// Allow/Deny, has finished, or has stopped on an error. The sounds are synthesised with Web Audio,
// so no audio files ship with the extension.

export type AlertKind = 'approval' | 'done' | 'error'

let audio: AudioContext | null = null

// Each sound is a short sequence of soft sine notes: [frequency Hz, start s, length s].
const TUNES: Record<AlertKind, [number, number, number][]> = {
  // Rising two-note chime, played twice: "your turn".
  approval: [
    [660, 0, 0.16],
    [880, 0.16, 0.22],
    [660, 0.55, 0.16],
    [880, 0.71, 0.26]
  ],
  // Gentle three-note arpeggio: "done".
  done: [
    [523.25, 0, 0.14],
    [659.25, 0.12, 0.14],
    [783.99, 0.24, 0.3]
  ],
  // Two low falling notes: "something went wrong".
  error: [
    [392, 0, 0.2],
    [311.13, 0.2, 0.34]
  ]
}

export function playSound(kind: AlertKind): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const start = audio.currentTime + 0.02
    for (const [frequency, offset, length] of TUNES[kind]) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      // Quick fade in and out so notes don't click.
      gain.gain.setValueAtTime(0, start + offset)
      gain.gain.linearRampToValueAtTime(0.18, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + length)
      osc.connect(gain).connect(audio.destination)
      osc.start(start + offset)
      osc.stop(start + offset + length + 0.05)
    }
  } catch {
    // No audio device, or audio blocked: the notification still shows.
  }
}

export const APPROVAL_PREFIX = 'llmraki-approve-'
const RESULT_ID = 'llmraki-result'

export function notify(
  kind: AlertKind,
  title: string,
  message: string,
  options: { stepId?: string; context?: string } = {}
): void {
  if (!chrome.notifications) return
  const id = kind === 'approval' && options.stepId ? APPROVAL_PREFIX + options.stepId : RESULT_ID
  // Our own sound plays from the panel, so the system notification is silent to avoid a double chime.
  void chrome.notifications.clear(id).then(() =>
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: message.slice(0, 250),
      ...(options.context ? { contextMessage: options.context.slice(0, 80) } : {}),
      silent: true,
      priority: kind === 'approval' ? 2 : 0,
      // An approval stays up until it's answered; results go away on their own.
      requireInteraction: kind === 'approval',
      ...(kind === 'approval' ? { buttons: [{ title: 'Allow' }, { title: 'Deny' }] } : {})
    })
  )
}

export function clearApprovalNotification(stepId: string): void {
  if (chrome.notifications) void chrome.notifications.clear(APPROVAL_PREFIX + stepId)
}

// Plain text for a notification: drop Markdown symbols and collapse whitespace.
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>|[\]]/g, '')
    .replace(/\(https?:[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
