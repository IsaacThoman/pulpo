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
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
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
    setLoading(true)
    setError(false)
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
    try { await pending } catch { if (mounted.current) setError(true) }
    finally { if (mounted.current) setLoading(false) }
  }, [chatId, userId])
  // One additional generous page is warmed even before the user starts scrolling.
  useEffect(() => { setError(false) }, [history?.leafId])
  const warmed = useRef(false)
  useEffect(() => {
    if (ready && !warmed.current && history?.hasMore) { warmed.current = true; void load() }
  }, [ready, history?.hasMore, load])
  return { history, loading, error, load }
}
