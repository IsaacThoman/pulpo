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
      className={cn(
        'desktop-sidebar-titlebar fixed left-0 top-0 z-40 h-[38px] motion-reduce:transition-none',
        transitions && 'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed
          ? 'w-[52px] bg-sidebar'
          : 'w-[264px] border-r border-sidebar-border bg-sidebar',
      )}
    />
  )
}
