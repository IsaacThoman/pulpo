import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/stores/auth'
import { mergeServerChatDetails, useChat, type ServerChat } from '@/stores/chat'
import { apiRequest } from '@/lib/api'
import { historyUrl } from '@/lib/chat-history'
import { queryClient } from '@/lib/query-client'

const requests = new Map<string, Promise<void>>()

export function useChatHistory(chatId: string, ready = true) {
  const userId = useAuth(state => state.user?.id)
  const history = useChat(state => state.chats.find(chat => chat.id === chatId)?.history)
  const scope = `${userId}:${chatId}:${history?.leafId}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  const [status, setStatus] = useState({ scope, error: false, loading: false })
  const { error, loading } = status.scope === scope ? status : { error: false, loading: false }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const load = useCallback(async () => {
    if (!userId) return
    const key = ['chat', userId, chatId]
    const current = queryClient.getQueryData<ServerChat>(key)
    if (!current?.history?.hasMore || !current.history.before) return
    const cursor = current.history.before
    const leaf = current.activeBranchLeafId ?? current.history.leafId
    const requestKey = JSON.stringify([...key, cursor, leaf])
    setStatus({ scope, loading: true, error: false })
    let pending = requests.get(requestKey)
    if (!pending) {
      pending = (async () => {
        const incoming = await apiRequest<ServerChat>(historyUrl(chatId, cursor))
        const latest = queryClient.getQueryData<ServerChat>(key)
        if (useAuth.getState().user?.id !== userId || !latest || (latest.activeBranchLeafId ?? latest.history?.leafId) !== leaf || incoming.history?.leafId !== leaf) return
        const merged = mergeServerChatDetails(latest, incoming)
        queryClient.setQueryData(key, merged)
        useChat.getState().setDetailedChat(merged)
      })().finally(() => requests.delete(requestKey))
      requests.set(requestKey, pending)
    }
    let failed = false
    try { await pending } catch { failed = true }
    finally {
      if (mounted.current && activeScope.current === scope) setStatus({ scope, loading: false, error: failed })
    }
  }, [chatId, userId, scope])
  // One additional generous page is warmed even before the user starts scrolling.
  const warmed = useRef<string | null>(null)
  const chatScope = `${userId}:${chatId}`
  useEffect(() => {
    if (ready && warmed.current !== chatScope && history?.hasMore) { warmed.current = chatScope; void load() }
  }, [ready, chatScope, history?.hasMore, load])
  return { history, loading, error, load }
}
