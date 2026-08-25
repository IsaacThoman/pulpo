import { NavLink, Outlet, useMatch } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

const TABS = [
  { to: '/admin/users', label: "Users", end: false },
  { to: '/admin/providers', label: "Providers", end: false },
  { to: '/admin/labs', label: "Labs", end: false },
  { to: '/admin/icons', label: "Icons", end: false },
  { to: '/admin/models', label: "Models", end: false },
  { to: '/admin/usage', label: "Usage", end: false },
  { to: '/admin/settings', label: "Settings", end: false },
]

export function AdminLayout() {
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const billingPage = useMatch('/admin/billing')
  const usersPage = useMatch('/admin/users')
  const widePage = billingPage || usersPage
  const tabs = billingEnabled
    ? [...TABS.slice(0, -1), { to: '/admin/billing', label: "Billing", end: false }, TABS.at(-1)!]
    : TABS
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
        <h1 className="text-sm font-semibold">{ui("Admin panel")}</h1>
        <nav className="flex items-center gap-1">
          {tabs.map((t) => (
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
              {ui(t.label)}
            </NavLink>
          ))}
        </nav>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn('mx-auto px-5 py-6', widePage ? 'max-w-7xl' : 'max-w-5xl')}>
          <Outlet />
        </div>
      </ScrollArea>
    </div>
  )
}
