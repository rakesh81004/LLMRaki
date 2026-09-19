import { useEffect, useState } from 'react'

interface GeminiModelInfo {
  id: string
  displayName: string
  description: string
  inputTokenLimit?: number
  outputTokenLimit?: number
}

type GeminiAvailabilityStatus = 'available' | 'rate_limited' | 'no_access' | 'error'

interface GeminiAvailability {
  id: string
  status: GeminiAvailabilityStatus
  message?: string
}

const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
]

// Placeholder shown only until a real key is saved and the live list loads — Google's lineup shifts often, so these are never relied on for the actual request.
const GEMINI_FALLBACK_MODELS: GeminiModelInfo[] = [
  { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', description: '' },
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (preview)', description: '' },
  { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite', description: '' }
]

const STATUS_LABEL: Record<GeminiAvailabilityStatus, string> = {
  available: 'Available now',
  rate_limited: 'Rate limited right now',
  no_access: 'No access with this key',
  error: 'Error'
}

const STATUS_COLOR: Record<GeminiAvailabilityStatus, string> = {
  available: 'var(--success)',
  rate_limited: '#e0a030',
  no_access: 'var(--danger)',
  error: 'var(--danger)'
}

type Provider = 'openai' | 'ollama' | 'gemini'

export default function SettingsPanel(): JSX.Element {
  const [provider, setProvider] = useState<Provider>('ollama')
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [model, setModel] = useState('gpt-4o-mini')
  const [ollamaModel, setOllamaModel] = useState('llama3.2')
  const [ollamaAvailableModels, setOllamaAvailableModels] = useState<string[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [geminiKey, setGeminiKeyInput] = useState('')
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash')
  const [geminiModels, setGeminiModels] = useState<GeminiModelInfo[]>(GEMINI_FALLBACK_MODELS)
  const [loadingGeminiModels, setLoadingGeminiModels] = useState(false)
  const [geminiAvailability, setGeminiAvailability] = useState<Record<string, GeminiAvailability>>({})
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    window.api.settings.getProvider().then(setProvider)
    window.api.settings.hasApiKey().then(setHasApiKey)
    window.api.settings.getModel().then(setModel)
    window.api.settings.getOllamaModel().then(setOllamaModel)
    window.api.settings.hasGeminiKey().then((has) => {
      setHasGeminiKey(has)
      if (has) refreshGeminiModels()
    })
    window.api.settings.getGeminiModel().then(setGeminiModel)
    refreshOllamaModels()
  }, [])

  async function refreshGeminiModels(): Promise<void> {
    setLoadingGeminiModels(true)
    setGeminiAvailability({})
    const models = await window.api.gemini.listModels()
    setGeminiModels(models.length > 0 ? models : GEMINI_FALLBACK_MODELS)
    setLoadingGeminiModels(false)
  }

  async function handleCheckAvailability(): Promise<void> {
    setCheckingAvailability(true)
    const results = await window.api.gemini.checkAvailability(geminiModels.map((m) => m.id))
    const map: Record<string, GeminiAvailability> = {}
    for (const r of results) map[r.id] = r
    setGeminiAvailability(map)
    setCheckingAvailability(false)
  }

  async function refreshOllamaModels(): Promise<void> {
    setOllamaStatus('checking')
    const models = await window.api.ollama.listModels()
    setOllamaAvailableModels(models)
    setOllamaStatus(models.length > 0 ? 'online' : 'offline')
  }

  async function handleProviderChange(value: Provider): Promise<void> {
    setProvider(value)
    await window.api.settings.setProvider(value)
    if (value === 'ollama') refreshOllamaModels()
    if (value === 'gemini' && hasGeminiKey) refreshGeminiModels()
  }

  async function handleSaveKey(): Promise<void> {
    if (!apiKey.trim()) return
    await window.api.settings.setApiKey(apiKey.trim())
    setApiKey('')
    setHasApiKey(true)
    setSavedMessage('API key saved.')
    setTimeout(() => setSavedMessage(''), 2000)
  }

  async function handleClearKey(): Promise<void> {
    await window.api.settings.clearApiKey()
    setHasApiKey(false)
  }

  async function handleModelChange(value: string): Promise<void> {
    setModel(value)
    await window.api.settings.setModel(value)
  }

  async function handleOllamaModelChange(value: string): Promise<void> {
    setOllamaModel(value)
    await window.api.settings.setOllamaModel(value)
  }

  async function handleSaveGeminiKey(): Promise<void> {
    if (!geminiKey.trim()) return
    await window.api.settings.setGeminiKey(geminiKey.trim())
    setGeminiKeyInput('')
    setHasGeminiKey(true)
    setSavedMessage('API key saved.')
    setTimeout(() => setSavedMessage(''), 2000)
    refreshGeminiModels()
  }

  async function handleClearGeminiKey(): Promise<void> {
    await window.api.settings.clearGeminiKey()
    setHasGeminiKey(false)
    setGeminiModels(GEMINI_FALLBACK_MODELS)
    setGeminiAvailability({})
  }

  async function handleGeminiModelChange(value: string): Promise<void> {
    setGeminiModel(value)
    await window.api.settings.setGeminiModel(value)
  }

  return (
    <>
      <div className="sidebar-header">
        <span>Settings</span>
      </div>
      <div className="settings-panel">
        <div className="settings-field">
          <label>AI Provider</label>
          <select value={provider} onChange={(e) => handleProviderChange(e.target.value as Provider)}>
            <option value="openai">OpenAI (paid, needs API key)</option>
            <option value="gemini">Google Gemini (free tier available, needs API key)</option>
            <option value="ollama">Ollama (free, runs locally)</option>
          </select>
        </div>

        {provider === 'openai' && (
          <>
            <div className="settings-field">
              <label>OpenAI API Key</label>
              {hasApiKey ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--success)' }}>●&nbsp; Key configured</span>
                  <button className="btn-secondary btn" onClick={handleClearKey}>
                    Remove
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    placeholder="sk-…"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button className="btn" onClick={handleSaveKey}>
                    Save
                  </button>
                </div>
              )}
              <div className="description">
                Stored locally, encrypted with your OS keychain via Electron's safeStorage. Never
                sent anywhere except directly to api.openai.com. Requires a paid OpenAI billing
                account with credits — the free chat.openai.com account does not include API
                access.
              </div>
              {savedMessage && (
                <div className="description" style={{ color: 'var(--success)' }}>
                  {savedMessage}
                </div>
              )}
            </div>

            <div className="settings-field">
              <label>Model</label>
              <select value={model} onChange={(e) => handleModelChange(e.target.value)}>
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="description">
                If your OpenAI account doesn't have access to a model, requests using it will
                fail — switch to one included in your plan.
              </div>
            </div>
          </>
        )}

        {provider === 'gemini' && (
          <>
            <div className="settings-field">
              <label>Gemini API Key</label>
              {hasGeminiKey ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--success)' }}>●&nbsp; Key configured</span>
                  <button className="btn-secondary btn" onClick={handleClearGeminiKey}>
                    Remove
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    placeholder="AIza… or AQ…"
                    value={geminiKey}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                  />
                  <button className="btn" onClick={handleSaveGeminiKey}>
                    Save
                  </button>
                </div>
              )}
              <div className="description">
                Stored locally, encrypted with your OS keychain via Electron's safeStorage. Never
                sent anywhere except directly to generativelanguage.googleapis.com. Get a free key
                at aistudio.google.com/apikey.
              </div>
              {savedMessage && (
                <div className="description" style={{ color: 'var(--success)' }}>
                  {savedMessage}
                </div>
              )}
            </div>

            <div className="settings-field">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Model</span>
                {hasGeminiKey && (
                  <button
                    className="btn-secondary btn"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={refreshGeminiModels}
                    disabled={loadingGeminiModels}
                  >
                    {loadingGeminiModels ? 'Loading…' : 'Refresh list'}
                  </button>
                )}
              </label>
              <select value={geminiModel} onChange={(e) => handleGeminiModelChange(e.target.value)}>
                {geminiModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <div className="description">
                {hasGeminiKey
                  ? "This list comes from your account's actual model access, fetched live via Gemini's ListModels API."
                  : 'Save your API key above to load the exact models available to your account.'}
              </div>
            </div>

            {hasGeminiKey && (
              <div className="settings-field">
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Current Availability</span>
                  <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={handleCheckAvailability} disabled={checkingAvailability}>
                    {checkingAvailability ? 'Checking…' : 'Check now'}
                  </button>
                </label>
                <div className="description" style={{ marginBottom: 8 }}>
                  Google doesn't expose a "remaining quota" API — this sends a tiny 1-token test
                  request to each model right now and reports whether it responds, so you can see
                  what's actually usable at this moment.
                </div>
                {Object.keys(geminiAvailability).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {geminiModels.map((m) => {
                      const result = geminiAvailability[m.id]
                      if (!result) return null
                      return (
                        <div
                          key={m.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                          title={result.message ?? ''}
                        >
                          <span style={{ color: STATUS_COLOR[result.status] }}>●</span>
                          <span style={{ flex: 1 }}>{m.displayName}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{STATUS_LABEL[result.status]}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {provider === 'ollama' && (
          <>
            <div className="settings-field">
              <label>Ollama Status</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {ollamaStatus === 'checking' && <span style={{ color: 'var(--text-muted)' }}>Checking…</span>}
                {ollamaStatus === 'online' && <span style={{ color: 'var(--success)' }}>● Running</span>}
                {ollamaStatus === 'offline' && <span style={{ color: 'var(--danger)' }}>● Not reachable</span>}
                <button className="btn-secondary btn" onClick={refreshOllamaModels}>
                  Refresh
                </button>
              </div>
              {ollamaStatus === 'offline' && (
                <div className="description">
                  Couldn't reach Ollama at localhost:11434. Start it with{' '}
                  <code>brew services start ollama</code> or run <code>ollama serve</code> in a
                  terminal.
                </div>
              )}
            </div>

            <div className="settings-field">
              <label>Model</label>
              {ollamaAvailableModels.length > 0 ? (
                <select value={ollamaModel} onChange={(e) => handleOllamaModelChange(e.target.value)}>
                  {ollamaAvailableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ollamaModel}
                  onChange={(e) => handleOllamaModelChange(e.target.value)}
                  placeholder="llama3.2"
                />
              )}
              <div className="description">
                No models installed? Run <code>ollama pull llama3.2</code> in a terminal (~2GB
                download), then hit Refresh. Fully free, runs on your Mac, no account needed.
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
