import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

const TABS = [
  { to: '/usage', label: "Personal", end: true },
  { to: '/usage/friends', label: "Friends", end: false },
  { to: '/usage/pool', label: "Pool", end: false },
]

export function UsageLayout() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
        <h1 className="shrink-0 text-sm font-semibold">{ui("Usage")}</h1>
        <nav className="settings-section-nav flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-medium'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )
              }
            >
              {ui(t.label)}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
