import { useLocation, useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { SIDE_PANEL_PARAM, useSidePanel, type PanelContent } from './store'

/**
 * False while a navigation is pending. The router applies navigations in a transition, but panel
 * changes render at once, so a handler that changes both renders first with the old location.
 */
export function locationIsCurrent(location: { key: string }): boolean {
  const entryKey = (window.history.state as { key?: string } | null)?.key
  return !entryKey || entryKey === location.key
}

/** The route that shows `content` as the main view. */
export function panelContentPath(content: PanelContent): string {
  if (content.kind === 'file') return `/files/d/${content.id}`
  return content.id ? `/files/f/${content.id}` : '/files'
}

/** What the main view shows, when it is something the panel can also show. */
export function mainViewContent(pathname: string): PanelContent | null {
  const file = /^\/files\/d\/([0-9a-f-]{36})$/i.exec(pathname)
  if (file) return { kind: 'file', id: file[1]!.toLowerCase() }
  const folder = /^\/files\/f\/([0-9a-f-]{36})$/i.exec(pathname)
  if (folder) return { kind: 'folder', id: folder[1]!.toLowerCase() }
  if (pathname === '/files') return { kind: 'folder', id: null }
  return null
}

/** Navigates the main view without adopting a stale `side` parameter from the current URL. */
export function useMainNavigate() {
  const navigate = useNavigate()
  const location = useLocation()
  return (pathname: string) => {
    // The side parameter is re-applied from the store; drop the old one so it cannot be adopted.
    const params = new URLSearchParams(location.search)
    params.delete(SIDE_PANEL_PARAM)
    navigate({ pathname, search: params.toString() ? `?${params}` : '' })
  }
}

/** Panel header actions shared by every kind of panel content. */
export function usePanelActions(content: PanelContent) {
  const go = useMainNavigate()
  const maximized = useSidePanel((state) => state.maximized)
  const target = panelContentPath(content)

  return {
    maximized,
    toggleMaximized: () => useSidePanel.getState().setMaximized(!maximized),
    close: () => useSidePanel.getState().close(),
    /**
     * Shows the panel's content on its own: in a new browser tab, or on desktop (which has no
     * tabs) by moving it into the main view.
     */
    openElsewhere: isDesktopRuntime()
      ? { newTab: false, run: () => { useSidePanel.getState().close(); go(target) } }
      : { newTab: true, run: () => { window.open(target, '_blank', 'noopener') } },
  }
}
