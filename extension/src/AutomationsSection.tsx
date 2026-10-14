import { useRef, useState } from 'react'
import { formatSize, readAttachment } from './attachments'
import { allAutomations, type AutomationInfo, type CustomAutomation } from './automations'
import type { Attachment, Mode, Settings } from './types'

interface Props {
  draft: Settings
  update: (patch: Partial<Settings>) => void
  builtIn: AutomationInfo[]
  onRun: (name: string) => void
}

const EMPTY: CustomAutomation = { name: '', title: '', trigger: '', mode: 'auto', description: '', instructions: '', media: [], autoApprove: [] }

const sitesFrom = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'automation'
}

export default function AutomationsSection({ draft, update, builtIn, onRun }: Props): JSX.Element {
  const custom = draft.customAutomations ?? []
  const list = allAutomations(builtIn, custom)
  const [editing, setEditing] = useState<CustomAutomation | null>(null)
  const [originalName, setOriginalName] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The auto-approve box as typed; turned into a list of sites on save.
  const [sitesText, setSitesText] = useState('')
  const mdRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)

  const save = (): void => {
    if (!editing || !editing.title.trim() || !editing.instructions.trim()) return
    const name = slug(editing.title)
    const next = custom.filter((a) => a.name !== originalName && a.name !== name)
    update({
      customAutomations: [...next, { ...editing, name, title: editing.title.trim(), trigger: editing.trigger.trim(), autoApprove: sitesFrom(sitesText) }]
    })
    setEditing(null)
    setOriginalName(null)
  }

  const addMedia = async (files: File[]): Promise<void> => {
    if (!editing) return
    setReading(true)
    setError(null)
    const added: Attachment[] = []
    for (const file of files) {
      try {
        added.push(await readAttachment(file))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    setEditing((e) => (e ? { ...e, media: [...e.media, ...added] } : e))
    setReading(false)
  }

  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label grow">Automations</span>
        {!editing && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setEditing({ ...EMPTY })
              setSitesText('')
            }}
          >
            Add automation
          </button>
        )}
      </div>
      <span className="field-hint">
        Repeatable tasks with their own instructions and files (like a résumé) that are attached on every run. Type an
        automation's trigger word in a message, or press Run.
      </span>

      {editing ? (
        <div className="skill-editor">
          <input placeholder="Name, e.g. CODE COLDDM" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <div className="field-row">
            <input
              placeholder="Trigger word, e.g. CODE COLDDM"
              value={editing.trigger}
              onChange={(e) => setEditing({ ...editing, trigger: e.target.value })}
            />
            <select value={editing.mode} onChange={(e) => setEditing({ ...editing, mode: e.target.value as Mode })}>
              <option value="auto">Auto</option>
              <option value="edit">Edit</option>
              <option value="ask">Ask</option>
            </select>
          </div>
          <input
            placeholder="What it does, in one sentence"
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          />
          <div className="field-row">
            <span className="field-hint grow">Instructions (paste, or load an .md file)</span>
            <button type="button" className="link-button" onClick={() => mdRef.current?.click()}>
              Load .md file
            </button>
            <input
              ref={mdRef}
              type="file"
              hidden
              accept=".md,.markdown,.txt"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const text = await file.text()
                const title = text.match(/^title:\s*(.+)$/m)?.[1] ?? text.match(/^name:\s*(.+)$/m)?.[1]
                const description = text.match(/^description:\s*(.+)$/m)?.[1]
                const sites = text.match(/^autoApprove:\s*(.+)$/m)?.[1]
                if (sites && !sitesText.trim()) setSitesText(sitesFrom(sites).join(', '))
                setEditing((cur) =>
                  cur
                    ? {
                        ...cur,
                        instructions: text,
                        title: cur.title || title || file.name.replace(/\.\w+$/, ''),
                        description: cur.description || description || ''
                      }
                    : cur
                )
              }}
            />
          </div>
          <textarea
            className="settings-textarea"
            rows={8}
            placeholder="Step-by-step instructions for the task."
            value={editing.instructions}
            onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
          />
          <input
            placeholder="Auto-approve on these sites after you answer its question, e.g. linkedin.com (optional)"
            value={sitesText}
            onChange={(e) => setSitesText(e.target.value)}
          />
          <div className="field-row">
            <span className="field-hint grow">Media files used on every run (résumé, templates, images)</span>
            <button type="button" className="ghost-button small" onClick={() => mediaRef.current?.click()} disabled={reading}>
              {reading ? 'Reading…' : 'Add files'}
            </button>
            <input
              ref={mediaRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void addMedia(files)
              }}
            />
          </div>
          {editing.media.length > 0 && (
            <ul className="memory-list">
              {editing.media.map((m, i) => (
                <li key={i}>
                  <span className="memory-text">
                    📎 {m.name} · {formatSize(m.size)}
                  </span>
                  <button
                    className="attach-remove"
                    title="Remove file"
                    onClick={() => setEditing({ ...editing, media: editing.media.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <span className="setup-error">{error}</span>}
          <div className="field-row">
            <button className="primary-button small" onClick={save} disabled={!editing.title.trim() || !editing.instructions.trim()}>
              Save automation
            </button>
            <button className="ghost-button small" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : list.length === 0 ? (
        <span className="field-hint">No automations yet.</span>
      ) : (
        <ul className="skill-list">
          {list.map((a) => {
            const files = a.builtIn ? (a.mediaPaths ?? []).map((m) => m.name) : (a.media ?? []).map((m) => m.name)
            return (
              <li key={a.name}>
                <div className="field-row">
                  <span className="skill-name grow">
                    {a.title}
                    <span className="skill-badge">{a.builtIn ? 'folder' : 'yours'}</span>
                    <span className="skill-badge">{a.mode}</span>
                  </span>
                  <button className="primary-button small" onClick={() => onRun(a.name)}>
                    Run
                  </button>
                  {!a.builtIn && (
                    <>
                      <button
                        className="link-button"
                        onClick={() => {
                          const mine = custom.find((c) => c.name === a.name)
                          if (mine) {
                            setEditing({ ...mine })
                            setSitesText((mine.autoApprove ?? []).join(', '))
                            setOriginalName(mine.name)
                          }
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="attach-remove"
                        title="Delete automation"
                        onClick={() => update({ customAutomations: custom.filter((c) => c.name !== a.name) })}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
                <div className="field-hint">{a.description}</div>
                <div className="field-hint">
                  {a.trigger ? (
                    <>
                      Trigger: <code>{a.trigger}</code>
                    </>
                  ) : (
                    'No trigger word — use Run'
                  )}
                  {files.length > 0 && <> · Files: {files.map((f) => `📎 ${f}`).join(', ')}</>}
                </div>
                {(a.autoApprove?.length ?? 0) > 0 && (
                  <div className="field-hint">
                    Runs without per-click prompts on {a.autoApprove!.join(', ')} once you’ve answered its question
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
