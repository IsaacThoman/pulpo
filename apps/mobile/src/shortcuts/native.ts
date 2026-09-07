export interface ShortcutsSession {
  status: string
  instanceUrl: string
  token: string | null
  user: { id: string; blocked?: boolean } | null
}

// Metro selects native.ios.ts on iOS. Android and JS-only tests do not load an
// Apple module, and old development clients can still run the rest of the app.
export const shortcutsAvailable = false
export function syncShortcutsSession(_state: ShortcutsSession): void {}
export function clearShortcutsSession(): void {}
export function shortcutsEnabled(): boolean { return false }
export function setShortcutsEnabled(_enabled: boolean): void {}
export function shortcutsScope(): string | null { return null }

export function listenForNativeShortcutLinks(_receive: (url: string) => void): () => void { return () => undefined }
