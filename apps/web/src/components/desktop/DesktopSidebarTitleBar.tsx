import { isDesktopRuntime } from '@/lib/runtime'
import { cn } from '@/lib/utils'

export function DesktopSidebarTitleBar({
  collapsed,
  transitions,
  visible,
}: {
  collapsed: boolean
  transitions: boolean
  visible: boolean
}) {
  if (!isDesktopRuntime() || !visible) return null
  return (
    <div
      aria-hidden="true"
      data-collapsed={collapsed ? 'true' : undefined}
      className="desktop-sidebar-titlebar pointer-events-none fixed inset-x-0 top-0 z-40 h-[38px]"
    >
      <div className="desktop-sidebar-titlebar-base absolute inset-y-0 left-0 w-[52px] bg-sidebar" />
      <div
        className={cn(
          'desktop-sidebar-titlebar-expanded absolute inset-y-0 left-[52px] border-r border-sidebar-border bg-sidebar motion-reduce:transition-none',
          transitions && 'transition-[width,opacity] duration-[6000ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
          collapsed ? 'w-0 opacity-0' : 'w-[212px] opacity-100',
        )}
      />
      <div
        className={cn(
          'desktop-sidebar-titlebar-collapsed absolute inset-0 w-full bg-sidebar motion-reduce:transition-none',
          transitions && 'transition-transform duration-[6000ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
          collapsed ? 'translate-y-0' : '-translate-y-[54px]',
        )}
      />
    </div>
  )
}
