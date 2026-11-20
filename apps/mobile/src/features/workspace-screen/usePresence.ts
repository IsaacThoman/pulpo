import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import type { WorkspaceScreenPresence } from '@pulpo/contracts'
import { fetchWorkspaceScreenPresence } from './api'
import { WorkspaceScreenPresenceTracker } from './presence'

/** The app's one tracker: every reply that offers a chat's screen shares its chat's answer. */
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

const noSubscription = () => () => undefined

/**
 * Whether the chat's workspace is still there, for the reply that offers its screen; undefined
 * until the first answer. While that reply is at work (`running`) the workspace is there without
 * asking, and the answer from before it started is forgotten.
 */
export function useWorkspaceScreenPresence(chatId: string, running: boolean): WorkspaceScreenPresence | undefined {
  const subscribe = useCallback(
    (listener: () => void) => workspaceScreenPresence.subscribe(chatId, listener),
    [chatId],
  )
  const presence = useSyncExternalStore(running ? noSubscription : subscribe, () => workspaceScreenPresence.get(chatId))
  useEffect(() => {
    if (running) workspaceScreenPresence.forget(chatId)
  }, [chatId, running])
  return running ? undefined : presence
}
