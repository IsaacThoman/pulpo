export interface DesktopStoredSession {
  instanceUrl: string
  token: string
  expiresAt: string
}

export type DesktopCommand = 'new-chat' | 'settings'
export type DesktopOperatingSystem = 'darwin' | 'win32' | 'linux'

export interface PulpoDesktopApi {
  readonly platform: 'desktop'
  readonly os: DesktopOperatingSystem
  session: {
    load: () => Promise<DesktopStoredSession | null>
    store: (session: DesktopStoredSession) => Promise<void>
    clear: () => Promise<void>
  }
  openExternal: (url: string) => Promise<void>
  onProtocolUrl: (listener: (url: string) => void) => () => void
  onCommand: (listener: (command: DesktopCommand) => void) => () => void
  appInfo: () => Promise<{ name: string; version: string; packaged: boolean }>
  windowControls: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChanged: (listener: (maximized: boolean) => void) => () => void
  }
}

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
  const MAIN_WINDOW_VITE_NAME: string
}
