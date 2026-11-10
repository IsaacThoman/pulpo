import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'

/** Friend requests and Pool invitations waiting on the signed-in user, badged on People and its Friends tab. */
export function usePendingSocialCount(): number {
  const userId = useAuth((state) => state.user?.id)
  const role = useAuth((state) => state.user?.role)
  const instanceReady = useAuth((state) => state.instanceReady)
  const enabled = Boolean((!isDesktopRuntime() || instanceReady) && userId && role !== 'pending')
  const friends = useQuery({
    queryKey: ['friends-pending-count', userId],
    queryFn: () => apiRequest<{ count: number }>('/api/friends/pending-count'),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const pools = useQuery({
    queryKey: ['pool-pending-count', userId],
    queryFn: () => apiRequest<{ count: number }>('/api/pools/pending-count'),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  return (friends.data?.count ?? 0) + (pools.data?.count ?? 0)
}
