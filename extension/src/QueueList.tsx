import type { Attachment } from './types'

// A message the user sent while LLMRaki was still busy, waiting its turn.
export interface QueuedMessage {
  id: string
  text: string
  attachments?: Attachment[]
  attachPage?: boolean
  // Set when this message continues a task that stopped at the step limit.
  continuation?: { task: string; count: number }
  // Run this automation (by name) with this message.
  automation?: string
}

interface Props {
  queue: QueuedMessage[]
  // Held after a Stop or an error, until the user chooses to carry on.
  paused: boolean
  // An Edit/Auto task is running, so plain messages will be read mid-task.
  agentRunning: boolean
  onRemove: (id: string) => void
  onEdit: (item: QueuedMessage) => void
  onResume: () => void
}

export default function QueueList({ queue, paused, agentRunning, onRemove, onEdit, onResume }: Props): JSX.Element {
  return (
    <div className="queue">
      <div className="queue-header">
        <span className="queue-title">
          {paused
            ? `Queue paused · ${queue.length} waiting`
            : agentRunning
              ? `Queued · read before the next step`
              : `Queued · sent when this reply finishes`}
        </span>
        {paused && (
          <button className="primary-button small" onClick={onResume}>
            Send next
          </button>
        )}
      </div>
      <ol className={`queue-items${queue.length > 4 ? ' scroll' : ''}`}>
        {queue.map((item, i) => (
          <li key={item.id} className="queue-item">
            <span className="queue-number">{i + 1}</span>
            <span className="queue-text" title={item.text}>
              {item.text || 'Attached files'}
              {(item.attachments?.length || item.attachPage) && (
                <span className="queue-extra">
                  {[
                    item.attachments?.length ? `${item.attachments.length} file${item.attachments.length === 1 ? '' : 's'}` : '',
                    item.attachPage ? 'page' : ''
                  ]
                    .filter(Boolean)
                    .join(' + ')}
                  {' · waits its turn'}
                </span>
              )}
            </span>
            {item.text && (
              <button className="link-button" onClick={() => onEdit(item)}>
                Edit
              </button>
            )}
            <button className="attach-remove" title="Remove from queue" onClick={() => onRemove(item.id)}>
              ×
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
