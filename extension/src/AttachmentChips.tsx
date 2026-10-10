import { formatSize } from './attachments'
import { FileIcon } from './Icons'
import type { Attachment } from './types'

// A file in the composer: still being read, ready to send, or refused (with the reason).
export interface PendingFile {
  id: string
  name: string
  size: number
  status: 'reading' | 'ready' | 'error'
  attachment?: Attachment
  error?: string
}

function Thumb({ attachment }: { attachment: Attachment }): JSX.Element {
  return attachment.kind === 'image' && attachment.data ? (
    <img className="attach-thumb" src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="" />
  ) : (
    <span className="attach-file-icon">
      <FileIcon />
    </span>
  )
}

export function PendingChips({ files, onRemove }: { files: PendingFile[]; onRemove: (id: string) => void }): JSX.Element {
  return (
    <div className="attach-list">
      {files.map((f) => (
        <div key={f.id} className={`attach-chip ${f.status}`} title={f.error ?? `${f.name} · ${formatSize(f.size)}`}>
          {f.attachment ? <Thumb attachment={f.attachment} /> : <span className="attach-file-icon"><FileIcon /></span>}
          <span className="attach-name">{f.name}</span>
          <span className="attach-meta">
            {f.status === 'reading'
              ? 'Reading…'
              : f.status === 'error'
                ? "Can't attach"
                : f.attachment?.truncated
                  ? 'Long — trimmed'
                  : formatSize(f.size)}
          </span>
          <button className="attach-remove" title="Remove" onClick={() => onRemove(f.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export function SentAttachments({ attachments }: { attachments: Attachment[] }): JSX.Element {
  return (
    <div className="sent-attachments">
      {attachments.map((a, i) =>
        a.kind === 'image' && a.data ? (
          <img key={i} className="sent-image" src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} title={a.name} />
        ) : (
          <div key={i} className="attach-chip ready" title={`${a.name} · ${formatSize(a.size)}`}>
            <span className="attach-file-icon">
              <FileIcon />
            </span>
            <span className="attach-name">{a.name}</span>
            <span className="attach-meta">{formatSize(a.size)}</span>
          </div>
        )
      )}
    </div>
  )
}
