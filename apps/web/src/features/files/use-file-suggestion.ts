import { useQueryClient } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { useAuth } from '@/stores/auth'
import { filesQueryKey, resolveFileSuggestion } from './api'

/** Accepts or rejects the suggestion that created `node`, refreshing every Files view. */
export function useResolveFileSuggestion() {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  return async (node: Pick<FileNode, 'id'>, action: 'accept' | 'reject') => {
    try {
      return await resolveFileSuggestion(node.id, action)
    } finally {
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    }
  }
}
