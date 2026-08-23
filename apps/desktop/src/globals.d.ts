export interface DesktopStoredSession {
  instanceUrl: string
  token: string
  expiresAt: string
}

export type DesktopCommand = 'new-chat' | 'settings'

export interface PulpoDesktopApi {
  readonly platform: 'desktop'
  session: {
    load: () => Promise<DesktopStoredSession | null>
    store: (session: DesktopStoredSession) => Promise<void>
    clear: () => Promise<void>
  }
  openExternal: (url: string) => Promise<void>
  onProtocolUrl: (listener: (url: string) => void) => () => void
  onCommand: (listener: (command: DesktopCommand) => void) => () => void
  appInfo: () => Promise<{ name: string; version: string; packaged: boolean }>
}

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
  const MAIN_WINDOW_VITE_NAME: string
}
