import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { scaledAnimationDuration } from '@/lib/animation-speed'
import {
  applySidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_SNAP_WIDTH,
} from './sidebar-width'

/** How long the sidebar takes to open or fold (its `duration-300`). */
const SIDEBAR_TRANSITION_MS = 300
const KEYBOARD_STEP = 16

/**
 * The desktop sidebar's edge: drag it to resize the sidebar, in past the snap point to fold it to
 * its rail, and the rail's edge out to open it again. Double-click restores the default width.
 */
export function SidebarResizeHandle({
  width,
  maxWidth,
  collapsed,
  animationSpeed,
  onTrackingChange,
  onOpenChange,
  onWidthChange,
}: {
  /** The open sidebar's width. */
  width: number
  maxWidth: number
  collapsed: boolean
  animationSpeed: number
  /** Whether the sidebar follows the pointer as is, without its transitions. */
  onTrackingChange: (tracking: boolean) => void
  onOpenChange: (open: boolean) => void
  /** Keeps a new open width. */
  onWidthChange: (width: number) => void
}) {
  const [resizing, setResizing] = useState(false)
  // A drag outlives the render it started in; it reports through whatever the layout passes now.
  const callbacks = useRef({ onTrackingChange, onOpenChange, onWidthChange })
  callbacks.current = { onTrackingChange, onOpenChange, onWidthChange }
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  const clamp = (next: number) => Math.round(Math.min(Math.max(next, SIDEBAR_MIN_WIDTH), maxWidth))

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : width
    let open = !collapsed
    let latest = width
    let settling = 0
    setResizing(true)
    callbacks.current.onTrackingChange(true)

    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = startWidth + moveEvent.clientX - startX
      if (open !== next >= SIDEBAR_SNAP_WIDTH) {
        open = !open
        // Opening and folding animate as they do from the toggle; following the pointer resumes after.
        window.clearTimeout(settling)
        callbacks.current.onTrackingChange(false)
        settling = window.setTimeout(
          () => callbacks.current.onTrackingChange(true),
          scaledAnimationDuration(SIDEBAR_TRANSITION_MS, animationSpeed),
        )
        callbacks.current.onOpenChange(open)
      }
      if (!open) return
      latest = clamp(next)
      applySidebarWidth(latest)
    }
    const end = () => {
      endDrag.current = null
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      window.clearTimeout(settling)
      setResizing(false)
      callbacks.current.onTrackingChange(false)
      if (!open) applySidebarWidth(width) // A folded sidebar reopens at the width it had.
      else if (latest !== width) callbacks.current.onWidthChange(latest)
    }
    endDrag.current = end
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  return (
    <div className="relative z-[42] w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ui("Resize sidebar")}
        aria-valuenow={collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}
        aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => {
          if (collapsed) callbacks.current.onOpenChange(true)
          callbacks.current.onWidthChange(clamp(DEFAULT_SIDEBAR_WIDTH))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            callbacks.current.onOpenChange(collapsed)
            return
          }
          if (collapsed || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
          event.preventDefault()
          callbacks.current.onWidthChange(clamp(width + (event.key === 'ArrowLeft' ? -KEYBOARD_STEP : KEYBOARD_STEP)))
        }}
        className={cn(
          'sidebar-resize-handle absolute inset-y-0 -left-0.5 w-2 outline-none',
          collapsed ? 'cursor-e-resize' : 'cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-px after:w-0.5 after:transition-colors hover:after:bg-sky-500/60 focus-visible:after:bg-sky-500',
          resizing && 'after:bg-sky-500',
        )}
      />
    </div>
  )
}
