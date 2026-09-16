import { app, Menu, BrowserWindow, MenuItemConstructorOptions } from 'electron'

function send(action: string): void {
  const win = BrowserWindow.getFocusedWindow()
  win?.webContents.send('menu:action', action)
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('open-settings') },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => send('new-file') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send('open-folder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save-file') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-file-as') },
        { type: 'separator' },
        { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send('open-command-palette')
        },
        { label: 'Go to File…', accelerator: 'CmdOrCtrl+P', click: () => send('open-quick-open') },
        { type: 'separator' },
        { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('view-explorer') },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('open-search') },
        {
          label: 'Source Control',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => send('view-source-control')
        },
        {
          label: 'Run and Debug',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send('view-run')
        },
        {
          label: 'Extensions',
          accelerator: 'CmdOrCtrl+Shift+X',
          click: () => send('view-extensions')
        },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-sidebar') },
        { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: () => send('toggle-panel') },
        { label: 'Toggle AI Chat', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('toggle-chat') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Terminal', accelerator: 'Ctrl+`', click: () => send('new-terminal') },
        { label: 'Split Terminal', click: () => send('split-terminal') }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Welcome', click: () => send('show-welcome') },
        { label: 'About LLMRaki', click: () => send('about') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
