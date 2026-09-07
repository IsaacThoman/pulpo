import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export function ComposerTray({ label, title, icon, count, collapsed, onCollapse, className, children }: {
  label: string
  title: string
  icon: ReactNode
  count: number
  collapsed: boolean
  onCollapse: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Collapsible open={!collapsed} onOpenChange={onCollapse} asChild>
      <section aria-label={label} className={cn('-mb-3 rounded-t-2xl border border-b-0 bg-card px-2 pt-1 pb-3 shadow-sm', className)}>
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground focus-visible:outline-ring">
          {icon}
          <span>{title} · {count}</span>
          <ChevronDown aria-hidden="true" className={cn('ml-auto size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none', collapsed && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent className="composer-tray-content" inert={collapsed}>
          <div className="max-h-48 overflow-y-auto pb-1">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}
