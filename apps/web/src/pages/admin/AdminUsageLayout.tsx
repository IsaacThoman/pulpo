import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

const TABS = [
  { to: '/admin/usage', label: ui("Leaderboard"), end: true },
  { to: '/admin/usage/requests', label: ui("Requests"), end: false },
  { to: '/admin/usage/workspaces', label: ui("Workspaces"), end: false },
]

export function AdminUsageLayout() {
  return <div className="space-y-5">
    <nav className="flex items-center gap-1 border-b pb-3">
      {TABS.map((tab) => <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cn('rounded-md px-2.5 py-1.5 text-sm transition-colors', isActive ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>{tab.label}</NavLink>)}
    </nav>
    <Outlet />
  </div>
}
