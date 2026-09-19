import { SidebarView } from '../types'
import {
  FilesIcon,
  SearchIcon,
  SourceControlIcon,
  RunIcon,
  ExtensionsIcon,
  ChatIcon,
  GearIcon,
  FolderIcon
} from './Icons'

interface Props {
  sidebarView: SidebarView | null
  chatOpen: boolean
  gitBadge: number
  onSelectSidebar: (view: SidebarView) => void
  onToggleChat: () => void
  onGoHome: () => void
}

export default function ActivityBar({
  sidebarView,
  chatOpen,
  gitBadge,
  onSelectSidebar,
  onToggleChat,
  onGoHome
}: Props): JSX.Element {
  return (
    <div className="activity-bar">
      <button
        className={`activity-icon ${sidebarView === 'explorer' ? 'active' : ''}`}
        title="Explorer (Cmd+Shift+E)"
        onClick={() => onSelectSidebar('explorer')}
      >
        <FilesIcon />
      </button>
      <button
        className={`activity-icon ${sidebarView === 'search' ? 'active' : ''}`}
        title="Search (Cmd+Shift+F)"
        onClick={() => onSelectSidebar('search')}
      >
        <SearchIcon />
      </button>
      <button
        className={`activity-icon ${sidebarView === 'sourceControl' ? 'active' : ''}`}
        title="Source Control (Cmd+Shift+G)"
        onClick={() => onSelectSidebar('sourceControl')}
      >
        <SourceControlIcon />
        {gitBadge > 0 && <span className="activity-badge">{gitBadge}</span>}
      </button>
      <button
        className={`activity-icon ${sidebarView === 'run' ? 'active' : ''}`}
        title="Run and Debug (Cmd+Shift+D)"
        onClick={() => onSelectSidebar('run')}
      >
        <RunIcon />
      </button>
      <button
        className={`activity-icon ${sidebarView === 'extensions' ? 'active' : ''}`}
        title="Extensions (Cmd+Shift+X)"
        onClick={() => onSelectSidebar('extensions')}
      >
        <ExtensionsIcon />
      </button>
      <button
        className={`activity-icon ${chatOpen ? 'active' : ''}`}
        title="AI Chat (Cmd+Shift+A)"
        onClick={onToggleChat}
      >
        <ChatIcon />
      </button>
      <div style={{ flex: 1 }} />
      <button className="activity-icon" title="Home" onClick={onGoHome}>
        <FolderIcon />
      </button>
      <button
        className={`activity-icon ${sidebarView === 'settings' ? 'active' : ''}`}
        title="Settings (Cmd+,)"
        onClick={() => onSelectSidebar('settings')}
      >
        <GearIcon />
      </button>
    </div>
  )
}
