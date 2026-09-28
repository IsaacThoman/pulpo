import { useLocation, useNavigate } from 'react-router-dom'
import type { NewChatLocationState } from '@/lib/new-chat-navigation'
import { SIDE_PANEL_PARAM, useSidePanel, type PanelContent } from './store'

/**
 * False while a navigation is pending. The router applies navigations in a transition, but panel
 * changes render at once, so a handler that changes both renders first with the old location.
 */
export function locationIsCurrent(location: { key: string }): boolean {
  const entryKey = (window.history.state as { key?: string } | null)?.key
  return !entryKey || entryKey === location.key
}

interface PanelTarget { pathname: string; state?: NewChatLocationState }

/** The route that shows `content` as the main view. */
export function panelContentPath(content: PanelContent): PanelTarget {
  if (content.kind === 'file') return { pathname: `/files/d/${content.id}` }
  if (content.id !== null) return { pathname: `/c/${content.id}` }
  return { pathname: '/', state: content.scopeIds.length ? { fileScopeIds: content.scopeIds } : undefined }
}

/** What the main view shows, when it is something the panel can also show. */
export function mainViewContent(pathname: string): PanelContent | null {
  const file = /^\/files\/d\/([0-9a-f-]{36})$/i.exec(pathname)
  if (file) return { kind: 'file', id: file[1]!.toLowerCase() }
  const chat = /^\/c\/([0-9a-f-]{36})$/i.exec(pathname)
  if (chat) return { kind: 'chat', id: chat[1]!.toLowerCase() }
  if (pathname === '/') return { kind: 'chat', id: null, scopeIds: [] }
  return null
}

/** Panel header actions shared by every kind of panel content. */
export function usePanelActions(content: PanelContent) {
  const navigate = useNavigate()
  const location = useLocation()
  const maximized = useSidePanel((state) => state.maximized)
  const target = panelContentPath(content)

  const go = ({ pathname, state }: PanelTarget) => {
    // The side parameter is re-applied from the store; drop the old one so it cannot be adopted.
    const params = new URLSearchParams(location.search)
    params.delete(SIDE_PANEL_PARAM)
    navigate({ pathname, search: params.toString() ? `?${params}` : '' }, { state })
  }

  return {
    maximized,
    toggleMaximized: () => useSidePanel.getState().setMaximized(!maximized),
    close: () => useSidePanel.getState().close(),
    /** Moves the panel's content into the main view and closes the panel. */
    openAsPage: () => { useSidePanel.getState().close(); go(target) },
  }
}
