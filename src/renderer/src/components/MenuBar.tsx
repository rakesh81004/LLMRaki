import { useEffect, useRef, useState } from 'react'

interface MenuAction {
  label: string
  action?: string
  role?: string
  accelerator?: string
}
type MenuEntry = MenuAction | 'separator'
interface MenuDef {
  label: string
  items: MenuEntry[]
}

// Mirrors src/main/menu.ts's Windows/Linux-relevant items (everything except the macOS-only
// app-name menu, Hide/Hide Others/Unhide, and the native Window menu). Kept as plain data so it's
// easy to tell at a glance that every action id here has a matching case in App.tsx's
// handleRunAction, and every role has a matching case in windowControl.ts's performRole.
const MENUS: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New File', action: 'new-file', accelerator: 'Ctrl+N' },
      { label: 'New Window', role: 'new-window', accelerator: 'Ctrl+Shift+N' },
      { label: 'Open Folder…', action: 'open-folder', accelerator: 'Ctrl+O' },
      'separator',
      { label: 'Save', action: 'save-file', accelerator: 'Ctrl+S' },
      { label: 'Save As…', action: 'save-file-as', accelerator: 'Ctrl+Shift+S' },
      'separator',
      { label: 'Close Editor', action: 'close-tab', accelerator: 'Ctrl+W' },
      'separator',
      { label: 'Exit', role: 'quit' }
    ]
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', role: 'undo', accelerator: 'Ctrl+Z' },
      { label: 'Redo', role: 'redo', accelerator: 'Ctrl+Y' },
      'separator',
      { label: 'Cut', role: 'cut', accelerator: 'Ctrl+X' },
      { label: 'Copy', role: 'copy', accelerator: 'Ctrl+C' },
      { label: 'Paste', role: 'paste', accelerator: 'Ctrl+V' },
      { label: 'Select All', role: 'selectAll', accelerator: 'Ctrl+A' }
    ]
  },
  {
    label: 'View',
    items: [
      { label: 'Command Palette…', action: 'open-command-palette', accelerator: 'Ctrl+Shift+P' },
      { label: 'Go to File…', action: 'open-quick-open', accelerator: 'Ctrl+P' },
      'separator',
      { label: 'Explorer', action: 'view-explorer', accelerator: 'Ctrl+Shift+E' },
      { label: 'Search', action: 'open-search', accelerator: 'Ctrl+Shift+F' },
      { label: 'Source Control', action: 'view-source-control', accelerator: 'Ctrl+Shift+G' },
      { label: 'Run and Debug', action: 'view-run', accelerator: 'Ctrl+Shift+D' },
      { label: 'Extensions', action: 'view-extensions', accelerator: 'Ctrl+Shift+X' },
      'separator',
      { label: 'Toggle Sidebar', action: 'toggle-sidebar', accelerator: 'Ctrl+B' },
      { label: 'Toggle Panel', action: 'toggle-panel', accelerator: 'Ctrl+J' },
      { label: 'Toggle AI Chat', action: 'toggle-chat', accelerator: 'Ctrl+Shift+A' },
      'separator',
      { label: 'Refresh Workspace', action: 'refresh-workspace' },
      { label: 'Toggle Developer Tools', role: 'toggleDevTools' },
      'separator',
      { label: 'Toggle Full Screen', role: 'togglefullscreen', accelerator: 'F11' }
    ]
  },
  {
    label: 'Terminal',
    items: [
      { label: 'New Terminal', action: 'new-terminal', accelerator: 'Ctrl+`' },
      { label: 'Split Terminal', action: 'split-terminal' }
    ]
  },
  {
    label: 'Help',
    items: [
      { label: 'Welcome', action: 'show-welcome' },
      { label: 'About LLMRaki', action: 'about' }
    ]
  }
]

interface Props {
  onAction: (action: string) => void
  onRole: (role: string) => void
}

export default function MenuBar({ onAction, onRole }: Props): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openIndex === null) return
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenIndex(null)
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpenIndex(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openIndex])

  function runEntry(entry: MenuAction): void {
    setOpenIndex(null)
    if (entry.role) onRole(entry.role)
    else if (entry.action) onAction(entry.action)
  }

  return (
    <div className="app-menubar" ref={ref}>
      {MENUS.map((menu, i) => (
        <div key={menu.label} className="menubar-item-wrapper">
          <button
            className={`menubar-item ${openIndex === i ? 'open' : ''}`}
            onClick={() => setOpenIndex((cur) => (cur === i ? null : i))}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(i)
            }}
          >
            {menu.label}
          </button>
          {openIndex === i && (
            <div className="context-menu menubar-dropdown">
              {menu.items.map((entry, j) =>
                entry === 'separator' ? (
                  <div key={j} className="context-menu-separator" />
                ) : (
                  <button key={j} className="context-menu-item menubar-dropdown-item" onClick={() => runEntry(entry)}>
                    <span>{entry.label}</span>
                    {entry.accelerator && <span className="menubar-accelerator">{entry.accelerator}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
