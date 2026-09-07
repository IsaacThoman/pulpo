import { requireOptionalNativeModule } from 'expo-modules-core'
import type { ShortcutsSession } from './native'

interface ShortcutsModule {
  setSession(origin: string | null, userID: string | null, token: string | null): void
  getEnabled(): boolean
  setEnabled(enabled: boolean): void
  getScope(): string | null
  takePendingNavigation?(): string[]
  addListener?(event: 'navigation', listener: () => void): { remove(): void }
}
const native = requireOptionalNativeModule<ShortcutsModule>('PulpoShortcuts')
export const shortcutsAvailable = native !== null
export function syncShortcutsSession(state: ShortcutsSession): void {
  if (!native || state.status === 'hydrating') return
  try {
    if (state.status === 'authenticated' && state.token && state.user && !state.user.blocked) {
      native.setSession(state.instanceUrl, state.user.id, state.token)
    } else native.setSession(null, null, null)
  } catch {
    // Native storage fails closed; preserve access to the main app even when
    // the device's Keychain is locked. A later session refresh retries the sync.
  }
}
export function clearShortcutsSession(): void {
  try { native?.setSession(null, null, null) } catch {
    // Native marks the session unavailable even if Keychain deletion fails.
    // Continue revoking the server session and clearing the main app's state.
  }
}
export function shortcutsEnabled(): boolean { return native?.getEnabled() ?? false }
export function setShortcutsEnabled(enabled: boolean): void { native?.setEnabled(enabled) }
export function shortcutsScope(): string | null { return native?.getScope() ?? null }

export function listenForNativeShortcutLinks(receive: (url: string) => void): () => void {
  if (!native?.takePendingNavigation || !native.addListener) return () => undefined
  const drain = () => { for (const url of native.takePendingNavigation!()) receive(url) }
  // Subscribe before draining: requests during bridge startup cannot fall into a gap.
  const subscription = native.addListener('navigation', drain)
  drain()
  return () => subscription.remove()
}
