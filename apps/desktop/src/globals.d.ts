export interface DesktopStoredSession {
  instanceUrl: string
  token: string
  expiresAt: string
}

export interface DesktopSignedInAccount {
  userId: string
  token: string
  expiresAt: string
}

/** Accounts signed in alongside the active session on one instance. */
export interface DesktopSignedInAccounts {
  instanceUrl: string
  accounts: DesktopSignedInAccount[]
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
  accounts: {
    load: () => Promise<DesktopSignedInAccounts | null>
    store: (accounts: DesktopSignedInAccounts) => Promise<void>
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
