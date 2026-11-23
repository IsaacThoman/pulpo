import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { WorkspaceScreenPresenceTracker } from '@pulpo/client-core'
import type { WorkspaceScreenPresence } from '@pulpo/contracts'
import { fetchWorkspaceScreenPresence } from './api'

/**
 * The app's one presence tracker (`@pulpo/client-core`): every reply that offers a chat's screen
 * shares its chat's answer. Nothing is asked while the app is in the background.
 */
export const workspaceScreenPresence = new WorkspaceScreenPresenceTracker({
  fetchPresence: fetchWorkspaceScreenPresence,
  foreground: {
    // `inactive` is iOS covering the app for a moment; only leaving it counts, as in the viewer.
    isForeground: () => AppState.currentState !== 'background',
    subscribe: (listener) => {
      const subscription = AppState.addEventListener('change', (state) => listener(state !== 'background'))
      return () => subscription.remove()
    },
  },
})

/**
 * Whether the chat's workspace is still there, for the reply that offers its screen; undefined
 * until the first answer. While that reply is at work (`running`) nothing is asked and the answer
 * from before it started is forgotten.
 */
export function useWorkspaceScreenPresence(chatId: string, running: boolean): WorkspaceScreenPresence | undefined {
  const subscribe = useCallback((listener: () => void) => workspaceScreenPresence.subscribe(chatId, listener), [chatId])
  useEffect(() => { workspaceScreenPresence.setBusy(chatId, running) }, [chatId, running])
  return useSyncExternalStore(subscribe, () => workspaceScreenPresence.get(chatId))
}
