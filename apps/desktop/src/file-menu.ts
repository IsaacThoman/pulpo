import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopCommand } from './globals'

/**
 * The File menu. While the page shows Files tabs it gets browser-style tab items: Cmd/Ctrl+W
 * closes the active tab, and closing the window moves to Shift+Cmd/Ctrl+W.
 */
export function fileMenuItems(filesTabs: boolean, send: (command: DesktopCommand) => void): MenuItemConstructorOptions[] {
  const newChat: MenuItemConstructorOptions = { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => send('new-chat') }
  if (!filesTabs) return [newChat, { type: 'separator' }, { role: 'close' }]
  return [
    newChat,
    { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => send('files-new-tab') },
    { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('files-reopen-tab') },
    { type: 'separator' },
    { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('files-close-tab') },
    { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
  ]
}
