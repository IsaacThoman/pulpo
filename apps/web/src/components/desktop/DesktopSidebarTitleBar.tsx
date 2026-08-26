import { useEffect, useRef, useState } from 'react'
import { isDesktopRuntime } from '@/lib/runtime'
import { cn } from '@/lib/utils'
import { DEFAULT_ANIMATION_SPEED, scaledAnimationDuration } from '@/lib/animation-speed'

const SIDEBAR_TRANSITION_MS = 300

export function DesktopSidebarTitleBar({
  collapsed,
  transitions,
  visible,
  animationSpeed = DEFAULT_ANIMATION_SPEED,
}: {
  collapsed: boolean
  transitions: boolean
  visible: boolean
  animationSpeed?: number
}) {
  const previousCollapsedRef = useRef(collapsed)
  const [animationActive, setAnimationActive] = useState(false)
  const collapsedChanged = previousCollapsedRef.current !== collapsed
  const showAboveSidebar = !transitions || (!collapsedChanged && !animationActive)
  const showCollapsedCap = collapsed || !showAboveSidebar

  useEffect(() => {
    const changed = previousCollapsedRef.current !== collapsed
    previousCollapsedRef.current = collapsed

    if (!transitions) {
      setAnimationActive(false)
      return
    }
    if (!changed) return

    setAnimationActive(true)
    const timeout = window.setTimeout(
      () => setAnimationActive(false),
      scaledAnimationDuration(SIDEBAR_TRANSITION_MS, animationSpeed),
    )
    return () => window.clearTimeout(timeout)
  }, [animationSpeed, collapsed, transitions])

  if (!isDesktopRuntime() || !visible) return null
  return (
    <div
      aria-hidden="true"
      data-collapsed={collapsed ? 'true' : undefined}
      data-animation-active={showAboveSidebar ? undefined : 'true'}
      className={cn(
        'desktop-sidebar-titlebar pointer-events-none fixed inset-x-0 top-0 h-[38px]',
        showAboveSidebar ? 'z-[42]' : 'z-[41]',
      )}
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
          showCollapsedCap ? 'block' : 'hidden',
        )}
      >
        <div className="desktop-sidebar-titlebar-collapsed-seam-cover absolute bottom-[-1px] left-0 h-[2px] w-[67px] bg-sidebar" />
      </div>
    </div>
  )
}
