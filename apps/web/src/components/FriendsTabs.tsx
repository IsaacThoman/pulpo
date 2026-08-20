import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'

function CountBadge({ count }: { count: number }) {
  if (!count) return null
  return <span className="grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">{count > 99 ? '99+' : count}</span>
}

export function FriendsTabs() {
  const userId = useAuth((state) => state.user?.id)
  const friends = useQuery({ queryKey: ['friends-pending-count', userId], queryFn: () => apiRequest<{ count: number }>('/api/friends/pending-count'), enabled: Boolean(userId), staleTime: 0, refetchOnWindowFocus: 'always' })
  const pools = useQuery({ queryKey: ['pool-pending-count', userId], queryFn: () => apiRequest<{ count: number }>('/api/pools/pending-count'), enabled: Boolean(userId), staleTime: 0, refetchOnWindowFocus: 'always' })
  return <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
    <h1 className="text-sm font-semibold">Friends</h1>
    <nav className="flex items-center gap-1">
      <NavLink end to="/friends" className={({ isActive }) => cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors', isActive ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>Friends<CountBadge count={friends.data?.count ?? 0} /></NavLink>
      <NavLink to="/friends/pool" className={({ isActive }) => cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors', isActive ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>Pool<CountBadge count={pools.data?.count ?? 0} /></NavLink>
    </nav>
  </header>
}
