import { useState } from 'react'
import {
  Database,
  LayoutGrid,
  Lock,
  Plug,
  SlidersHorizontal,
} from 'lucide-react'
import { AuthenticationSection, GeneralSection, InterfaceSection } from './sections-general'
import { DatabaseSection } from './sections-data'
import { ConnectionsPage } from '../ConnectionsPage'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, el: <GeneralSection /> },
  { id: 'auth', label: 'Authentication', icon: Lock, el: <AuthenticationSection /> },
  { id: 'connections', label: 'Connections', icon: Plug, el: <ConnectionsPage /> },
  { id: 'interface', label: 'Interface', icon: LayoutGrid, el: <InterfaceSection /> },
  { id: 'database', label: 'Database', icon: Database, el: <DatabaseSection /> },
] as const

export function AdminSettingsPage() {
  const [active, setActive] = useState<(typeof SECTIONS)[number]['id']>('general')
  const current = SECTIONS.find((s) => s.id === active)!

  return (
    <div className="flex gap-6">
      <nav className="w-44 shrink-0 space-y-0.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
              active === s.id
                ? 'bg-accent font-medium'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <s.icon className="size-4" />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{current.el}</div>
    </div>
  )
}
