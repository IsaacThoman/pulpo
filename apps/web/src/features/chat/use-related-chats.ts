import { useQuery } from '@tanstack/react-query'
import { relatedChatsSchema, type RelatedChats } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { relatedChatsQueryKey } from './related-chats'

export async function fetchRelatedChats(chatId: string, signal?: AbortSignal): Promise<RelatedChats> {
  return relatedChatsSchema.parse(await apiRequest<unknown>(`/api/chats/${chatId}/related`, { signal }))
}

/** While a thread works, check on it now and then in case a realtime update is missed. */
const WORKING_POLL_MS = 30_000

/**
 * The chats around `chatId`. With `enabled` false it only reads what another view already loaded
 * (and follows its updates), without a request of its own.
 */
export function useRelatedChats(chatId: string | null | undefined, enabled = true) {
  const userId = useAuth((state) => state.user?.id)
  return useQuery({
    queryKey: relatedChatsQueryKey(userId, chatId ?? undefined),
    queryFn: ({ signal }) => fetchRelatedChats(chatId!, signal),
    enabled: Boolean(enabled && userId && chatId),
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => query.state.data?.threads.some((thread) => thread.status === 'working') ? WORKING_POLL_MS : false,
  // The app's client, like the chat store's, so chat views need no provider of their own.
  }, queryClient)
}
