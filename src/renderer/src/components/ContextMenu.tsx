import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export type ContextMenuEntry = ContextMenuItem | 'separator'

interface Props {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : x
  const maxY = typeof window !== 'undefined' ? window.innerHeight - items.length * 28 - 20 : y

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: Math.min(x, maxX), top: Math.min(y, Math.max(maxY, 10)) }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
