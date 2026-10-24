import { useLocation, useNavigate } from 'react-router-dom'
import { folderPath, trashFolderRef } from '@/features/trash/folder'
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
  if (content.kind === 'attachment') return `/attachments/${content.id}`
  return folderPath(content.id)
}

/** What the main view shows, when it is something the panel can also show. */
export function mainViewContent(pathname: string): PanelContent | null {
  const file = /^\/files\/d\/([0-9a-f-]{36})$/i.exec(pathname)
  if (file) return { kind: 'file', id: file[1]!.toLowerCase() }
  const attachment = /^\/attachments\/([0-9a-f-]{36})$/i.exec(pathname)
  if (attachment) return { kind: 'attachment', id: attachment[1]!.toLowerCase() }
  const folder = /^\/files\/f\/([0-9a-f-]{36})$/i.exec(pathname)
  if (folder) return { kind: 'folder', id: folder[1]!.toLowerCase() }
  if (pathname === '/files') return { kind: 'folder', id: null }
  if (pathname === '/files/trash') return { kind: 'folder', id: trashFolderRef(null) }
  const trashed = /^\/files\/trash\/f\/([0-9a-f-]{36})$/i.exec(pathname)
  if (trashed) return { kind: 'folder', id: trashFolderRef(trashed[1]!.toLowerCase()) }
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

/**
 * Shows a file or folder beside the main view, or, when the window has no room for a split, in
 * the main view itself.
 */
export function openBeside(content: PanelContent, go: (pathname: string) => void): void {
  if (useSidePanel.getState().splitAvailable) useSidePanel.getState().open(content)
  else go(panelContentPath(content))
}

/** `openBeside` bound to the router, for components. */
export function useOpenBeside(): (content: PanelContent) => void {
  const go = useMainNavigate()
  return (content) => openBeside(content, go)
}
