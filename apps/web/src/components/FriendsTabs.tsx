import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function FriendsTabs() {
  return <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
    <h1 className="text-sm font-semibold">Friends</h1>
    <nav className="flex items-center gap-1">
      <NavLink end to="/friends" className={({ isActive }) => cn('rounded-md px-2.5 py-1.5 text-sm transition-colors', isActive ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>Friends</NavLink>
      <NavLink to="/friends/pool" className={({ isActive }) => cn('rounded-md px-2.5 py-1.5 text-sm transition-colors', isActive ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>Pool</NavLink>
    </nav>
  </header>
}
