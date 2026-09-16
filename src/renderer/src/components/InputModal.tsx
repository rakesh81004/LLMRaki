import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  initialValue?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onClose: () => void
}

export default function InputModal({
  title,
  initialValue = '',
  confirmLabel = 'OK',
  onSubmit,
  onClose
}: Props): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function submit(): void {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onClose()
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div
        className="palette-box"
        style={{ padding: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
        <input
          ref={inputRef}
          className="input-modal-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
