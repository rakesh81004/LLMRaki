import { useState } from 'react'
import { checkGeminiKey, GEMINI_KEY_URL, pickModel } from './gemini'
import { checkCompatKey, pickCompatModel } from './llm'
import { PROVIDER_LABELS } from './providers'
import type { Settings } from './types'

export type KeyedProvider = 'gemini' | 'groq' | 'mistral'

export const KEY_PAGES: Record<KeyedProvider, { url: string; site: string; placeholder: string }> = {
  gemini: { url: GEMINI_KEY_URL, site: 'Google AI Studio', placeholder: 'AIza…' },
  groq: { url: 'https://console.groq.com/keys', site: 'the Groq console', placeholder: 'gsk_…' },
  mistral: { url: 'https://console.mistral.ai/api-keys', site: 'the Mistral console', placeholder: 'Mistral API key' }
}

const FIELDS = {
  gemini: { key: 'geminiKey', model: 'geminiModel' },
  groq: { key: 'groqKey', model: 'groqModel' },
  mistral: { key: 'mistralKey', model: 'mistralModel' }
} as const

type Check = { ok: true; models: string[] } | { ok: false; error: string } | 'checking' | null

// Checks a key with its provider and, if it works, picks a model it offers. Shared by Settings and first-time setup.
export async function verifyKey(provider: KeyedProvider, settings: Settings, key: string): Promise<{ ok: true; patch: Partial<Settings>; models: string[] } | { ok: false; error: string }> {
  if (provider === 'gemini') {
    const result = await checkGeminiKey(key)
    if (!result.ok) return result
    return {
      ok: true,
      models: result.models,
      patch: { geminiKey: key, geminiModel: pickModel(result.models, settings.geminiModel), geminiModels: result.models }
    }
  }
  const result = await checkCompatKey(provider, key)
  if (!result.ok) return result
  const field = FIELDS[provider].model
  return { ok: true, models: result.models, patch: { [FIELDS[provider].key]: key, [field]: pickCompatModel(provider, result.models, settings[field]) } }
}

interface Props {
  provider: KeyedProvider
  draft: Settings
  update: (patch: Partial<Settings>) => void
  // Shown as a backup provider rather than the main one.
  backup?: boolean
}

export default function KeySection({ provider, draft, update, backup }: Props): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [check, setCheck] = useState<Check>(null)
  const { key: keyField, model: modelField } = FIELDS[provider]
  const label = PROVIDER_LABELS[provider]

  const runCheck = (): void => {
    setCheck('checking')
    void verifyKey(provider, draft, draft[keyField]).then((result) => {
      if (!result.ok) return setCheck(result)
      setCheck({ ok: true, models: result.models })
      update(result.patch)
    })
  }

  return (
    <div className={backup ? 'key-section backup' : 'key-section'}>
      <label className="field">
        <span className="field-label">
          {label} API key{backup ? ' — backup' : ''}
          {backup && draft[keyField] && <span className="key-ready"> ✓ added</span>}
        </span>
        <div className="field-row">
          <input
            type={visible ? 'text' : 'password'}
            value={draft[keyField]}
            placeholder={KEY_PAGES[provider].placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              update({ [keyField]: e.target.value.trim() })
              setCheck(null)
            }}
          />
          <button type="button" className="ghost-button" onClick={() => setVisible((v) => !v)}>
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      <div className="field-row">
        <a href={KEY_PAGES[provider].url} target="_blank" rel="noreferrer" className="primary-link grow">
          Get a free key from {KEY_PAGES[provider].site}
        </a>
        <button type="button" className="ghost-button" onClick={runCheck} disabled={!draft[keyField] || check === 'checking'}>
          Check key
        </button>
      </div>
      {check && (
        <span className={check === 'checking' ? 'field-hint' : check.ok ? 'field-hint ok' : 'setup-error'}>
          {check === 'checking' ? 'Checking…' : check.ok ? `Key works — ${check.models.length} models available.` : check.error}
        </span>
      )}
      {!backup && (
        <label className="field">
          <span className="field-label">Model</span>
          {check && check !== 'checking' && check.ok ? (
            <select value={draft[modelField]} onChange={(e) => update({ [modelField]: e.target.value })}>
              {!check.models.includes(draft[modelField]) && <option value={draft[modelField]}>{draft[modelField]}</option>}
              {check.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input value={draft[modelField]} onChange={(e) => update({ [modelField]: e.target.value.trim() })} />
          )}
        </label>
      )}
    </div>
  )
}
