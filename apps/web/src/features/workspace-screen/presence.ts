import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { WorkspaceScreenPresenceTracker } from '@pulpo/client-core'
import type { WorkspaceScreenPresence } from '@pulpo/contracts'
import { fetchScreenPresence } from './api'

/**
 * The page's one presence tracker (`@pulpo/client-core`): every reply that offers a chat's screen
 * shares its chat's answer. Nothing is asked while the tab is hidden.
 */
const tracker = new WorkspaceScreenPresenceTracker({
  fetchPresence: fetchScreenPresence,
  foreground: {
    isForeground: () => document.visibilityState !== 'hidden',
    subscribe: (listener) => {
      const changed = () => listener(document.visibilityState !== 'hidden')
      document.addEventListener('visibilitychange', changed)
      return () => document.removeEventListener('visibilitychange', changed)
    },
  },
})

/** Asks again now, if the chat is being shown: the viewer closed. */
export function refreshWorkspaceScreenPresence(chatId: string): void {
  tracker.ask(chatId)
}

/** Forgets every chat's presence; for tests. */
export function resetWorkspaceScreenPresence(): void {
  tracker.reset()
}

/**
 * The chat's last known presence, or undefined before the first answer. `busy`: a reply in the chat
 * is at work, so nothing is asked (and an older answer is forgotten) until it finishes.
 */
export function useWorkspaceScreenPresence(chatId: string, busy: boolean): WorkspaceScreenPresence | undefined {
  const subscribe = useCallback((listener: () => void) => tracker.subscribe(chatId, listener), [chatId])
  useEffect(() => { tracker.setBusy(chatId, busy) }, [chatId, busy])
  return useSyncExternalStore(subscribe, () => tracker.get(chatId), () => undefined)
}
