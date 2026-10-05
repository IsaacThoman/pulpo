import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SidePanel } from './SidePanel'
import { splitFits, useSidePanel } from './store'

/** Own animated width measurements without rerendering the sidebar or the main view. */
export function SidePanelLayout({ children, mobile, full, enabled }: {
  children: ReactNode
  mobile: boolean
  full: boolean
  enabled: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panelOpen = useSidePanel((state) => state.content !== null)
  const [available, setAvailable] = useState(0)

  useLayoutEffect(() => {
    if (useSidePanel.getState().enabled !== enabled) useSidePanel.setState({ enabled })
  }, [enabled])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      const width = mobile ? 0 : container.clientWidth
      const splitAvailable = splitFits(width)
      if (useSidePanel.getState().splitAvailable !== splitAvailable) {
        useSidePanel.setState({ splitAvailable })
      }
      // A closed panel only needs breakpoint changes for "open beside" actions, not pixels.
      if (enabled && panelOpen) setAvailable(width)
    }
    // Also measure before paint on opening, so a previously closed panel uses the current width.
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [enabled, mobile, panelOpen])

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1">
      {children}
      {enabled && <SidePanel available={available} full={full} />}
    </div>
  )
}
