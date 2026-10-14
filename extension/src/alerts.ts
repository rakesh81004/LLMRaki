// Sound and system notifications for the moments that need the user: LLMRaki is waiting for an
// Allow/Deny, has finished, or has stopped on an error. The sounds are synthesised with Web Audio,
// so no audio files ship with the extension.

// 'applied': one job application went through (its tune climbs with each one in the task).
export type AlertKind = 'approval' | 'done' | 'error' | 'applied'

let audio: AudioContext | null = null

// Each sound is a short sequence of soft sine notes: [frequency Hz, start s, length s].
const TUNES: Record<Exclude<AlertKind, 'applied'>, [number, number, number][]> = {
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

// A bright "ding-ding" that starts one step higher on the scale for each application, so you can
// hear 1, 2, 3… go by; the last one of the task plays a short fanfare instead.
const APPLIED_SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760]
function appliedTune(count: number, goal?: number): [number, number, number][] {
  if (goal && count >= goal) {
    return [
      [523.25, 0, 0.12],
      [659.25, 0.11, 0.12],
      [783.99, 0.22, 0.12],
      [1046.5, 0.33, 0.45]
    ]
  }
  const note = APPLIED_SCALE[(Math.max(1, count) - 1) % APPLIED_SCALE.length]
  return [
    [note, 0, 0.1],
    [note * 1.5, 0.1, 0.28]
  ]
}

export function playSound(kind: AlertKind, progress?: { count: number; goal?: number }): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const start = audio.currentTime + 0.02
    const tune = kind === 'applied' ? appliedTune(progress?.count ?? 1, progress?.goal) : TUNES[kind]
    for (const [frequency, offset, length] of tune) {
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
  // id: a notification of its own instead of replacing the last result (one per application).
  options: { stepId?: string; context?: string; buttons?: string[]; id?: string } = {}
): void {
  if (!chrome.notifications) return
  // Anything tied to a step is waiting for the user's answer (Allow/Deny, Try again/Skip…).
  const waiting = !!options.stepId
  const id = waiting ? APPROVAL_PREFIX + options.stepId : (options.id ?? RESULT_ID)
  const buttons = options.buttons ?? (kind === 'approval' ? ['Allow', 'Deny'] : [])
  // Our own sound plays from the panel, so the system notification is silent to avoid a double chime.
  void chrome.notifications.clear(id).then(() =>
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: message.slice(0, 250),
      ...(options.context ? { contextMessage: options.context.slice(0, 80) } : {}),
      silent: true,
      priority: waiting ? 2 : 0,
      // Something waiting for an answer stays up until it's answered; results go away on their own.
      requireInteraction: waiting,
      ...(buttons.length ? { buttons: buttons.slice(0, 2).map((title) => ({ title })) } : {})
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
