import { Link, NavLink, Outlet, useMatch } from 'react-router-dom'
import { ArrowRight, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

const TABS = [
  { to: '/friends', label: "People", end: true },
  { to: '/friends/leaderboard', label: "Leaderboard", end: false },
]

/** Friends hub: managing people and comparing usage with them share one header. */
export function FriendsLayout() {
  const onLeaderboard = useMatch('/friends/leaderboard')
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
        <h1 className="shrink-0 text-sm font-semibold">{ui("Friends")}</h1>
        <nav className="settings-section-nav flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-medium'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )
              }
            >
              {ui(tab.label)}
            </NavLink>
          ))}
        </nav>
        {onLeaderboard && <Button asChild size="sm" variant="ghost" className="shrink-0 text-muted-foreground">
          {/* Phones keep the tabs readable by collapsing this link to the sidebar's Usage icon. */}
          <Link to="/usage"><BarChart3 className="sm:hidden" /><span className="sr-only sm:not-sr-only">{ui("Personal usage")}</span><ArrowRight className="max-sm:hidden" /></Link>
        </Button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
