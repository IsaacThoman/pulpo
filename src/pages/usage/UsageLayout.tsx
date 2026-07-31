import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useUsage } from '@/stores/usage'
import { useAuth } from '@/stores/auth'

const TABS = [
  { to: '/usage', label: 'Personal', end: true },
  { to: '/usage/leaderboard', label: 'Leaderboard', end: false },
  { to: '/usage/analytics', label: 'Analytics', end: false },
]

export function UsageLayout() {
  const role = useAuth((state) => state.user?.role)
  const loadPersonal = useUsage((state) => state.loadPersonal)
  const loadLeaderboard = useUsage((state) => state.loadLeaderboard)
  useEffect(() => {
    void Promise.all([loadPersonal(), loadLeaderboard()])
  }, [loadLeaderboard, loadPersonal])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
        <h1 className="text-sm font-semibold">Usage</h1>
        <nav className="flex items-center gap-1">
          {TABS.filter((tab) => tab.to !== '/usage/analytics' || role === 'admin').map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-medium'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <Outlet />
        </div>
      </ScrollArea>
    </div>
  )
}
