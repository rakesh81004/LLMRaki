import { ipcMain, Notification, BrowserWindow } from 'electron'

// A native OS notification (Notification Center on macOS, Action Center on Windows) shows up
// regardless of whether the window is focused, minimized, or the user is in a different app
// entirely — unlike an in-page toast, which only the renderer's own window can display.
export function registerNotificationHandlers(): void {
  ipcMain.handle('notifications:chatComplete', (event) => {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: 'LLMRaki',
      body: 'AI response finished generating.',
      silent: false
    })
    notification.on('click', () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
    notification.show()
  })
}
