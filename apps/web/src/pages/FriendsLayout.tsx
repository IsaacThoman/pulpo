import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

const TABS = [
  { to: '/friends', label: "People", end: true },
  { to: '/friends/leaderboard', label: "Leaderboard", end: false },
]

/** Friends hub: managing people and comparing usage with them share one header. */
export function FriendsLayout() {
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
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
