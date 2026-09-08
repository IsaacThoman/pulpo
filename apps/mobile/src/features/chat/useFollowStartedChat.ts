import { useLayoutEffect, useRef, type RefObject } from 'react'
import { AppState, type TextInput } from 'react-native'
import { canFollowStartedChat, type ChatFollowState } from '@pulpo/client-core'
import { cacheNamespace } from '../../data/database'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { mobileChatStarted } from './chatStarted'

export function useFollowStartedChat(input: {
  namespace: string | null
  chatId: string | null
  screenFocused: boolean
  textarea: RefObject<TextInput | null>
  temporary: boolean
  busy: () => boolean
  open: (chatId: string) => void
}) {
  const current = useRef(input)
  current.current = input
  useLayoutEffect(() => {
    const { namespace } = input
    if (!namespace || input.chatId) return
    return mobileChatStarted.follow(namespace, () => {
      const latest = current.current
      const session = useSessionStore.getState()
      const state: ChatFollowState = {
        newChat: !latest.chatId && latest.screenFocused,
        inputFocused: latest.textarea.current?.isFocused() === true,
        foreground: AppState.currentState === 'active',
        syncEnabled: usePreferencesStore.getState().composerSyncEnabled,
        temporary: latest.temporary,
        busy: latest.busy(),
      }
      return latest.namespace === namespace && session.status === 'authenticated'
        && Boolean(session.user && cacheNamespace(session.instanceUrl, session.user.id) === namespace)
        && canFollowStartedChat(state)
    }, ({ chatId }) => current.current.open(chatId))
  }, [input.namespace, input.chatId])
}
