import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { allFileChangesQueryKey } from '../api'
import type { DocSyncStatus } from '@pulpo/client-core/doc-sync'

/** Recount chat change cards only after the server has acknowledged the edited suggestions. */
export function useSuggestionRecount(userId: string, status: DocSyncStatus): () => void {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!pending || status.state !== 'synced') return
    setPending(false)
    void queryClient.invalidateQueries({ queryKey: allFileChangesQueryKey(userId) })
  }, [pending, queryClient, status.state, userId])
  return useCallback(() => setPending(true), [])
}
