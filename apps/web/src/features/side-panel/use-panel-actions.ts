import { useLocation, useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import type { TabSnapshot } from '@/features/files/tabs/model'
import { folderPath } from '@/features/trash/folder'
import { mainViewShows } from './content'
import { panelTabActions, SIDE_PANEL_PARAM, useSidePanel, type PanelContent } from './store'

export { mainViewContent, mainViewShows } from './content'

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
 * Shows a file or folder beside the main view (in a panel tab already showing it, or a new one),
 * or, when the window has no room for a split, in the main view itself.
 */
export function openBeside(content: PanelContent, go: (pathname: string) => void, snapshot?: TabSnapshot | null): void {
  // The main view's own file or attachment is already in view (and opens in one view at a time).
  if (mainViewShows(content)) return
  if (useSidePanel.getState().splitAvailable) useSidePanel.getState().open(content, snapshot)
  else go(panelContentPath(content))
}

/**
 * Opens something in the main view from inside the panel. The panel stays as it is beside the
 * main view; it hides (keeping its tabs) when it holds one thing at a time (`keepPanel` false,
 * with Files turned off), or takes the main view's place for lack of room for both, so the main
 * view shows what opened.
 */
export function showInMain(content: PanelContent, go: (pathname: string) => void, keepPanel = true): void {
  const state = useSidePanel.getState()
  if (state.content && (!keepPanel || !state.splitAvailable)) state.close()
  go(panelContentPath(content))
}

/**
 * Moves what a panel tab shows into the main view: the tab closes (the panel hides after its
 * last) and the main view opens it, by its own tab rules.
 */
export function moveToMain(content: PanelContent, go: (pathname: string) => void): void {
  panelTabActions.closeShowing(content)
  showInMain(content, go)
}

/** Moves one panel tab into the main view, as `moveToMain` does for the tab that shows. */
export function moveTabToMain(tab: { id: string; location: PanelContent }, go: (pathname: string) => void): void {
  panelTabActions.close(tab.id)
  showInMain(tab.location, go)
}

/** `openBeside` bound to the router, for components. */
export function useOpenBeside(): (content: PanelContent) => void {
  const go = useMainNavigate()
  return (content) => openBeside(content, go)
}

/** Panel window actions shared by every kind of panel content. */
export function usePanelActions(content: PanelContent) {
  const go = useMainNavigate()
  const target = panelContentPath(content)

  return {
    /** Hides the panel; its tabs come back with it. */
    close: () => useSidePanel.getState().close(),
    /** Makes the panel's content the main view: its tab closes and the page opens it. */
    openInMain: () => moveToMain(content, go),
    /** A new browser tab; the desktop app has no tabs. */
    openInNewTab: isDesktopRuntime() ? null : () => { window.open(target, '_blank', 'noopener') },
  }
}
