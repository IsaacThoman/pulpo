import { useLocation, useNavigate } from 'react-router-dom'
import { SIDE_PANEL_PARAM, useSidePanel, type PanelContent } from './store'

/** The route that shows `content` as the main view. */
export function panelContentPath(content: PanelContent): string | null {
  if (content.kind === 'file') return `/files/d/${content.id}`
  if (content.id !== null) return `/c/${content.id}`
  // A new chat's folders live only in the panel, so it cannot move to the main view as-is.
  return content.folderIds.length ? null : '/'
}

/** What the main view shows, when it is something the panel can also show. */
export function mainViewContent(pathname: string): PanelContent | null {
  const file = /^\/files\/d\/([0-9a-f-]{36})$/i.exec(pathname)
  if (file) return { kind: 'file', id: file[1]!.toLowerCase() }
  const chat = /^\/c\/([0-9a-f-]{36})$/i.exec(pathname)
  if (chat) return { kind: 'chat', id: chat[1]!.toLowerCase() }
  if (pathname === '/') return { kind: 'chat', id: null, folderIds: [] }
  return null
}

/** Panel header actions shared by every kind of panel content. */
export function usePanelActions(content: PanelContent) {
  const navigate = useNavigate()
  const location = useLocation()
  const maximized = useSidePanel((state) => state.maximized)
  const target = panelContentPath(content)
  const main = mainViewContent(location.pathname)

  const go = (path: string) => {
    // The side parameter is re-applied from the store; drop the old one so it cannot be adopted.
    const params = new URLSearchParams(location.search)
    params.delete(SIDE_PANEL_PARAM)
    navigate({ pathname: path, search: params.toString() ? `?${params}` : '' })
  }

  return {
    maximized,
    toggleMaximized: () => useSidePanel.getState().setMaximized(!maximized),
    close: () => useSidePanel.getState().close(),
    /** Moves the panel's content into the main view and closes the panel. */
    openAsPage: target ? () => { useSidePanel.getState().close(); go(target) } : undefined,
    /** Exchanges the main view and the panel, when both can show the other's content. */
    swap: target && main ? () => { useSidePanel.getState().open(main); go(target) } : undefined,
  }
}
