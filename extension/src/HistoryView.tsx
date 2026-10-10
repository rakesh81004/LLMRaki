import type { Conversation } from './types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onOpen: (conversation: Conversation) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function HistoryView({ conversations, activeId, onOpen, onDelete, onClose }: Props): JSX.Element {
  return (
    <div className="history">
      <div className="view-header">
        <h2>Chats</h2>
        <button className="ghost-button" onClick={onClose}>
          Back
        </button>
      </div>
      {conversations.length === 0 ? (
        <p className="field-hint">No saved chats yet.</p>
      ) : (
        <ul className="history-list">
          {conversations.map((c) => (
            <li key={c.id} className={c.id === activeId ? 'active' : ''}>
              <button className="history-open" onClick={() => onOpen(c)} title={c.title}>
                <span className="history-title">{c.title}</span>
                <span className="history-when">{formatWhen(c.updatedAt)}</span>
              </button>
              <button className="history-delete" title="Delete chat" onClick={() => onDelete(c.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
