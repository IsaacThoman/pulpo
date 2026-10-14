import { useQueryClient } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { useAuth } from '@/stores/auth'
import { filesQueryKey, resolveFileSuggestion } from './api'

/**
 * The item a suggestion was made on: `node`, or the topmost of its folders (`ancestors`, from
 * the top of My files down) in the same suggestion. What an agent creates inside a suggested
 * folder shares its suggestion, and accepting or rejecting any part of it acts on all of it.
 */
export function suggestionRoot(node: FileNode, ancestors: readonly FileNode[]): FileNode {
  const changeId = node.suggestion?.changeId
  let root = node
  for (const folder of [...ancestors].reverse()) {
    if (!changeId || folder.suggestion?.changeId !== changeId) break
    root = folder
  }
  return root
}

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
