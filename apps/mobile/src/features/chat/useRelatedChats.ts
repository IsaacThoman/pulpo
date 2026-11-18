import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../data/queries'
import { fetchRelatedChats } from './threads'

export const relatedChatsQueryKey = (namespace: string, chatId: string) => ['chat-related', namespace, chatId] as const

/**
 * The chat a chat came from, and its threads and side chats. Refetched whenever the chat itself is
 * (realtime changes, a thread update arriving), since that is when its threads move on.
 */
export function useRelatedChats(namespace: string | null, chatId: string | null, enabled: boolean) {
  const queryClient = useQueryClient()
  const active = Boolean(enabled && namespace && chatId)
  const query = useQuery({
    queryKey: relatedChatsQueryKey(namespace ?? '', chatId ?? ''),
    queryFn: ({ signal }) => fetchRelatedChats(chatId!, signal),
    enabled: active,
    staleTime: 15_000,
    retry: false,
  })
  useEffect(() => {
    if (!active) return
    const chatKey = queryKeys.chat(namespace!, chatId!)
    return queryClient.getQueryCache().subscribe((event) => {
      // Only fetches from the server: local cache writes (optimistic turns) say nothing about threads.
      if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return
      const key: readonly unknown[] = event.query.queryKey
      if (key.length !== chatKey.length || key.some((part: unknown, index: number) => part !== chatKey[index])) return
      void queryClient.invalidateQueries({ queryKey: relatedChatsQueryKey(namespace!, chatId!), exact: true })
    })
  }, [active, chatId, namespace, queryClient])
  return query
}
