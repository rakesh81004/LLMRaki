import { useState } from 'react'
import { KEY_PAGES, verifyKey, type KeyedProvider } from './KeySection'
import { PROVIDER_LABELS } from './providers'
import type { Settings } from './types'

interface Props {
  settings: Settings
  onDone: (settings: Settings) => void
  onOtherProvider: () => void
  // Open straight on the backups step (Gemini already connected).
  backupsOnly?: boolean
}

function BackupKey({
  provider,
  settings,
  onAdded
}: {
  provider: Exclude<KeyedProvider, 'gemini'>
  settings: Settings
  onAdded: (patch: Partial<Settings>) => void
}): JSX.Element {
  const keyField = provider === 'groq' ? 'groqKey' : 'mistralKey'
  const [key, setKey] = useState(settings[keyField])
  const [state, setState] = useState<'idle' | 'checking' | 'added' | { error: string }>(settings[keyField] ? 'added' : 'idle')

  const add = async (): Promise<void> => {
    setState('checking')
    const result = await verifyKey(provider, settings, key.trim())
    if (!result.ok) return setState({ error: result.error })
    onAdded(result.patch)
    setState('added')
  }

  return (
    <div className="backup-card">
      <div className="field-row">
        <strong className="grow">{PROVIDER_LABELS[provider]}</strong>
        {state === 'added' && <span className="key-ready">✓ added</span>}
      </div>
      <a href={KEY_PAGES[provider].url} target="_blank" rel="noreferrer" className="primary-link">
        Get a free key from {KEY_PAGES[provider].site}
      </a>
      <div className="backup-key-row">
        <input
          type="password"
          value={key}
          placeholder={KEY_PAGES[provider].placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setKey(e.target.value.trim())
            if (state !== 'checking') setState('idle')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key) void add()
          }}
        />
        <button className="ghost-button" onClick={() => void add()} disabled={!key || state === 'checking'}>
          {state === 'checking' ? 'Checking…' : 'Test & add'}
        </button>
      </div>
      {typeof state === 'object' && <div className="setup-error">{state.error}</div>}
    </div>
  )
}

export default function GeminiSetup({ settings, onDone, onOtherProvider, backupsOnly }: Props): JSX.Element {
  const [key, setKey] = useState(settings.geminiKey)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // After the Gemini key works, a second step offers the free backup providers.
  const [saved, setSaved] = useState<Settings | null>(backupsOnly ? settings : null)

  const save = async (): Promise<void> => {
    setChecking(true)
    setError(null)
    const result = await verifyKey('gemini', settings, key.trim())
    setChecking(false)
    if (!result.ok) return setError(result.error)
    setSaved({ ...settings, ...result.patch, provider: 'gemini', providerChosen: true })
  }

  if (saved) {
    const backupCount = [saved.groqKey, saved.mistralKey].filter(Boolean).length
    return (
      <div className="setup">
        <img src="icons/icon128.png" alt="" className="setup-logo" />
        <h2>{backupsOnly ? 'Add free backups' : 'Gemini is connected'}</h2>
        <p className="field-hint">
          Gemini's free tier only allows a few requests a minute. Add free backups and LLMRaki switches to them
          whenever Gemini hits its limit, instead of stopping. Each takes about a minute and is optional.
        </p>
        <BackupKey provider="groq" settings={saved} onAdded={(patch) => setSaved((s) => ({ ...s!, ...patch }))} />
        <BackupKey provider="mistral" settings={saved} onAdded={(patch) => setSaved((s) => ({ ...s!, ...patch }))} />
        <button className="primary-button" onClick={() => onDone(saved)}>
          {backupCount > 0 ? `Done — ${backupCount} backup${backupCount === 1 ? '' : 's'} added` : 'Done'}
        </button>
        {backupCount === 0 && (
          <button className="link-button center" onClick={() => onDone(saved)}>
            Skip for now — I can add them later in Settings
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="setup">
      <img src="icons/icon128.png" alt="" className="setup-logo" />
      <h2>Connect LLMRaki to Gemini</h2>
      <p className="field-hint">
        LLMRaki uses Google's Gemini to answer and to work on pages. It needs a free API key — this
        takes about a minute.
      </p>
      <ol className="setup-steps">
        <li>
          <a href={KEY_PAGES.gemini.url} target="_blank" rel="noreferrer" className="primary-link">
            Get a free key from Google AI Studio
          </a>{' '}
          and sign in with your Google account.
        </li>
        <li>Click “Create API key”, then copy it.</li>
        <li>Paste it below.</li>
      </ol>
      <div className="field">
        <input
          type="password"
          value={key}
          placeholder="AIza…"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(e) => setKey(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !checking) void save()
          }}
        />
      </div>
      {error && <div className="setup-error">{error}</div>}
      <button className="primary-button" onClick={() => void save()} disabled={checking || !key}>
        {checking ? 'Checking key…' : 'Test & save'}
      </button>
      <p className="field-hint">
        The key stays in this browser and is only sent to Google.{' '}
        <button className="link-button" onClick={onOtherProvider}>
          Use another provider instead
        </button>
      </p>
    </div>
  )
}
