import { useEffect, useRef, useState } from 'react'
import { isDesktopRuntime } from '@/lib/runtime'
import { cn } from '@/lib/utils'
import { DEFAULT_ANIMATION_SPEED, scaledAnimationDuration } from '@/lib/animation-speed'
import { useDesktopChrome } from '@/stores/desktopChrome'

const SIDEBAR_TRANSITION_MS = 300
export const DESKTOP_COLLAPSED_MODEL_PICKER_ID = 'desktop-collapsed-model-picker'

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
  const desktopVisible = isDesktopRuntime() && visible
  const setSidebarTitleBarVisible = useDesktopChrome((state) => state.setSidebarTitleBarVisible)

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

  useEffect(() => {
    setSidebarTitleBarVisible(desktopVisible)
    return () => setSidebarTitleBarVisible(false)
  }, [desktopVisible, setSidebarTitleBarVisible])

  if (!desktopVisible) return null
  return (
    <div
      data-collapsed={collapsed ? 'true' : undefined}
      data-animation-active={showAboveSidebar ? undefined : 'true'}
      className={cn(
        'desktop-sidebar-titlebar pointer-events-none fixed inset-x-0 top-0 h-[38px]',
        showAboveSidebar ? 'z-[42]' : 'z-[41]',
      )}
    >
      <div aria-hidden="true" className="desktop-sidebar-titlebar-base absolute inset-y-0 left-0 z-10 w-[52px] bg-sidebar" />
      <div
        aria-hidden="true"
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
          'desktop-sidebar-titlebar-collapsed absolute inset-y-0 left-0 z-0 w-[280px] rounded-br-[22px] border-b border-r border-sidebar-border bg-sidebar',
          showCollapsedCap ? 'block' : 'hidden',
        )}
      >
        <div aria-hidden="true" className="desktop-sidebar-titlebar-collapsed-seam-cover absolute bottom-[-1px] left-0 h-[2px] w-[67px] bg-sidebar" />
      </div>
      <div
        id={DESKTOP_COLLAPSED_MODEL_PICKER_ID}
        className={cn(
          'desktop-collapsed-model-picker-host desktop-no-drag pointer-events-auto absolute top-[3px] z-20 flex w-[184px] justify-end motion-reduce:transition-none',
          transitions && 'transition-[left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          collapsed ? 'left-[72px]' : 'left-[276px]',
        )}
      />
    </div>
  )
}
