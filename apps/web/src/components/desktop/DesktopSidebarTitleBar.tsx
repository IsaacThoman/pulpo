import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { cn } from '@/lib/utils'
import { DEFAULT_ANIMATION_SPEED, scaledAnimationDuration } from '@/lib/animation-speed'

const SIDEBAR_TRANSITION_MS = 300
const MODEL_SLOT_ID = 'desktop-model-titlebar-slot'
const ACTIONS_SLOT_ID = 'desktop-actions-titlebar-slot'

function DesktopTitleBarPortal({ children, targetId }: { children: ReactNode; targetId: string }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setTarget(document.getElementById(targetId))
  }, [targetId])

  return target ? createPortal(children, target) : null
}

export function DesktopModelTitleBarSlot({ children }: { children: ReactNode }) {
  return <DesktopTitleBarPortal targetId={MODEL_SLOT_ID}>{children}</DesktopTitleBarPortal>
}

export function DesktopActionsTitleBarSlot({ children }: { children: ReactNode }) {
  return <DesktopTitleBarPortal targetId={ACTIONS_SLOT_ID}>{children}</DesktopTitleBarPortal>
}

export function DesktopSidebarTitleBar({
  collapsed,
  compact = false,
  transitions,
  visible,
  animationSpeed = DEFAULT_ANIMATION_SPEED,
}: {
  collapsed: boolean
  compact?: boolean
  transitions: boolean
  visible: boolean
  animationSpeed?: number
}) {
  const previousCollapsedRef = useRef(collapsed)
  const [animationActive, setAnimationActive] = useState(false)
  const windows = typeof window !== 'undefined' && window.pulpoDesktop?.os === 'win32'
  const collapsedChanged = previousCollapsedRef.current !== collapsed
  const showAboveSidebar = !transitions || (!collapsedChanged && !animationActive)

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
    <>
      <div
        aria-hidden="true"
        data-collapsed={collapsed ? 'true' : undefined}
        data-compact={compact ? 'true' : undefined}
        data-animation-active={showAboveSidebar ? undefined : 'true'}
        className={cn(
          'desktop-sidebar-titlebar pointer-events-none fixed inset-x-0 top-0 h-[38px]',
          windows ? 'z-40' : showAboveSidebar ? 'z-[42]' : 'z-[41]',
        )}
      >
        {!windows && (
          <>
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
                'desktop-sidebar-titlebar-collapsed absolute inset-0 z-0 w-full bg-sidebar motion-reduce:transition-none',
                transitions && 'transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
                collapsed ? 'translate-y-0' : '-translate-y-[54px]',
              )}
            />
          </>
        )}
      </div>
      <div
        data-collapsed={collapsed ? 'true' : undefined}
        data-compact={compact ? 'true' : undefined}
        data-position-animation-active={!windows && transitions && !showAboveSidebar ? 'true' : undefined}
        id={MODEL_SLOT_ID}
        className={cn(
          'desktop-model-titlebar-slot desktop-no-drag pointer-events-auto fixed top-0 z-[43] flex min-w-0 items-center motion-reduce:transition-none',
          transitions && 'transition-[left,height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        )}
      />
      <div
        data-collapsed={collapsed ? 'true' : undefined}
        data-compact={compact ? 'true' : undefined}
        id={ACTIONS_SLOT_ID}
        className={cn(
          'desktop-actions-titlebar-slot desktop-no-drag pointer-events-auto fixed top-0 right-3 z-[43] flex items-center gap-1 motion-reduce:transition-none',
          transitions && 'transition-[height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        )}
      />
    </>
  )
}
