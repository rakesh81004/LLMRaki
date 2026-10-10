import { useEffect, useState } from 'react'
import KeySection, { type KeyedProvider } from './KeySection'
import { notify, playSound } from './alerts'
import { versionLabel } from './updates'
import { listOllamaModels, PROVIDER_LABELS } from './providers'
import { hasPageAccess, requestPageAccess } from './pageContext'
import type { Provider, Settings } from './types'

const BACKUPS: KeyedProvider[] = ['gemini', 'groq', 'mistral']

interface Props {
  settings: Settings
  onSave: (settings: Settings) => void
  onClose: () => void
}

function KeyField({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}): JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-row">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <button type="button" className="ghost-button" onClick={() => setVisible((v) => !v)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  )
}

export default function SettingsView({ settings, onSave, onClose }: Props): JSX.Element {
  const [draft, setDraft] = useState<Settings>(settings)
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)
  const [pageAccess, setPageAccess] = useState(false)

  const update = (patch: Partial<Settings>): void => setDraft((d) => ({ ...d, ...patch }))

  const refreshOllamaModels = (): void => {
    setOllamaModels(null)
    void listOllamaModels().then(setOllamaModels)
  }

  useEffect(() => {
    if (draft.provider === 'ollama' && ollamaModels === null) refreshOllamaModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.provider])

  useEffect(() => {
    void hasPageAccess().then(setPageAccess)
  }, [])

  const togglePageAccess = (): void => {
    if (pageAccess) {
      void chrome.permissions.remove({ origins: ['<all_urls>'] }).then(() => setPageAccess(false))
    } else {
      void requestPageAccess().then(setPageAccess)
    }
  }

  return (
    <div className="settings">
      <div className="view-header">
        <h2>Settings</h2>
        <button className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>

      <div className="field">
        <span className="field-label">Provider</span>
        <div className="segmented">
          {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
            <button
              key={p}
              className={draft.provider === p ? 'active' : ''}
              onClick={() => update({ provider: p })}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {draft.provider === 'openai' && (
        <>
          <KeyField
            label="OpenAI API key"
            value={draft.openaiKey}
            placeholder="sk-…"
            onChange={(openaiKey) => update({ openaiKey })}
          />
          <label className="field">
            <span className="field-label">Model</span>
            <input value={draft.openaiModel} onChange={(e) => update({ openaiModel: e.target.value.trim() })} />
          </label>
        </>
      )}

      {(draft.provider === 'gemini' || draft.provider === 'groq' || draft.provider === 'mistral') && (
        <KeySection key={draft.provider} provider={draft.provider} draft={draft} update={update} />
      )}

      {draft.provider === 'ollama' && (
        <label className="field">
          <span className="field-label">Model</span>
          <div className="field-row">
            {ollamaModels && ollamaModels.length > 0 ? (
              <select value={draft.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value })}>
                {!ollamaModels.includes(draft.ollamaModel) && <option value={draft.ollamaModel}>{draft.ollamaModel}</option>}
                {ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input value={draft.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value.trim() })} />
            )}
            <button type="button" className="ghost-button" onClick={refreshOllamaModels}>
              Refresh
            </button>
          </div>
          <span className="field-hint">
            {ollamaModels === null
              ? 'Looking for Ollama on localhost:11434…'
              : ollamaModels.length === 0
                ? 'Ollama isn\'t reachable. Start it with "ollama serve". If chats are refused, set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.'
                : `${ollamaModels.length} local model${ollamaModels.length === 1 ? '' : 's'} found.`}
          </span>
        </label>
      )}

      <div className="backups">
        <div className="field-row">
          <span className="field-label grow">Free backups</span>
          <label className="toggle">
            <input type="checkbox" checked={draft.fallback !== false} onChange={(e) => update({ fallback: e.target.checked })} />
            Use automatically
          </label>
        </div>
        <p className="field-hint">
          Each free provider has its own limit. When {PROVIDER_LABELS[draft.provider]} hits one, LLMRaki carries on with the
          next provider that has a key, so it doesn't stop.
        </p>
        {draft.fallback !== false &&
          BACKUPS.filter((p) => p !== draft.provider).map((p) => (
            <KeySection key={`backup-${p}`} provider={p} draft={draft} update={update} backup />
          ))}
      </div>

      <div className="field">
        <div className="field-row">
          <span className="field-label grow">Alerts</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (draft.sound) playSound('approval')
              if (draft.notifications) {
                notify('done', 'LLMRaki alert test', 'This is how LLMRaki tells you it needs your OK or has finished.')
              }
            }}
          >
            Test
          </button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={draft.sound} onChange={(e) => update({ sound: e.target.checked })} />
          Play a sound
        </label>
        <label className="toggle">
          <input type="checkbox" checked={draft.notifications} onChange={(e) => update({ notifications: e.target.checked })} />
          Show a notification
        </label>
        <span className="field-hint">
          When LLMRaki needs your Allow / Deny, finishes, or stops on an error. You can answer Allow / Deny right from the
          notification.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Reading web pages</span>
        <div className="field-row">
          <span className="field-hint grow">
            {pageAccess
              ? 'Allowed. A page is only read when you attach it to a message.'
              : 'Not allowed yet. You will be asked the first time you attach a page.'}
          </span>
          <button type="button" className="ghost-button" onClick={togglePageAccess}>
            {pageAccess ? 'Revoke' : 'Allow'}
          </button>
        </div>
      </div>

      <p className="field-hint">
        API keys are saved in this browser profile's extension storage and are only sent to the
        provider you pick. They aren't synced to other devices.
      </p>

      <button className="primary-button" onClick={() => onSave(draft)}>
        Save
      </button>

      <p className="version-line">{versionLabel()}</p>
    </div>
  )
}
