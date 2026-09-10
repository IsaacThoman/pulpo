import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { canFollowStartedChat } from '@pulpo/client-core'
import { webChatStarted } from '@/lib/chat-started'
import { localAccountKey } from '@/lib/local-first/database'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'

export function useFollowStartedChat(input: {
  userId?: string
  chatId: string | null
  textarea: RefObject<HTMLTextAreaElement | null>
  syncEnabled: boolean
  temporary: boolean
  busy: () => boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const scope = input.userId ? localAccountKey(input.userId) : null
  const current = useRef({ input, pathname: location.pathname, scope, navigate })
  current.current = { input, pathname: location.pathname, scope, navigate }

  useLayoutEffect(() => {
    if (!scope || input.chatId) return
    return webChatStarted.follow(scope, () => {
      const latest = current.current
      const { input } = latest
      const userId = useAuth.getState().user?.id
      return latest.scope === scope && Boolean(userId && localAccountKey(userId) === scope)
        && canFollowStartedChat({
          newChat: !input.chatId && latest.pathname === '/',
          inputFocused: input.textarea.current !== null && document.activeElement === input.textarea.current,
          foreground: document.visibilityState === 'visible' && document.hasFocus(),
          syncEnabled: input.syncEnabled && useSettings.getState().composerSyncEnabled,
          temporary: input.temporary,
          busy: input.busy(),
        })
    }, ({ chatId }) => current.current.navigate(`/c/${chatId}`))
  }, [scope, input.chatId])
}
