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
      className="desktop-sidebar-titlebar pointer-events-none fixed inset-x-0 top-0 z-[42] h-[38px]"
    >
      <div className="desktop-sidebar-titlebar-base absolute inset-y-0 left-0 z-10 w-[52px] bg-sidebar" />
      <div
        className={cn(
          'desktop-sidebar-titlebar-expanded absolute inset-y-0 left-[52px] z-10 bg-sidebar motion-reduce:transition-none',
          transitions && 'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          collapsed ? 'w-0' : 'w-[212px]',
        )}
      >
        <div
          className={cn(
            'desktop-sidebar-titlebar-expanded-border absolute inset-y-0 right-0 border-r border-sidebar-border motion-reduce:transition-none',
            transitions && 'transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            collapsed ? 'opacity-0' : 'opacity-100',
          )}
        />
      </div>
      <div
        className={cn(
          'desktop-sidebar-titlebar-collapsed absolute inset-y-0 left-0 z-0 w-[124px] rounded-br-[22px] border-b border-r border-sidebar-border bg-sidebar',
          collapsed ? 'block' : 'hidden',
        )}
      >
        <div className="desktop-sidebar-titlebar-collapsed-seam-cover absolute bottom-[-1px] left-0 h-[2px] w-[67px] bg-sidebar" />
      </div>
    </div>
  )
}
