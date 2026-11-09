import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { ensurePanelTabs, parsePanelContent, serializePanelContent, setPanelTabsEnabled, SIDE_PANEL_PARAM, useSidePanel } from './store'
import { mainViewShows } from './content'
import { locationIsCurrent } from './use-panel-actions'

/**
 * Mirrors the side panel into the URL so reloads and shared links reopen it. The panel belongs
 * to the window, not the page: navigating the main view carries the parameter along, while a URL
 * that arrives with a different panel (a link, back/forward) shows that content, in a panel tab
 * already showing it or a new one. Only the active tab is in the URL; the panel's tabs are kept
 * per window and account, and load here first, so a reload restores them around the URL's tab.
 */
export function useSidePanelUrl(): void {
  const location = useLocation()
  const navigate = useNavigate()
  const content = useSidePanel((state) => state.content)
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const lastApplied = useRef<string | null>(null)

  // Layout effects run before the effect below, so the URL's tab joins the account's tabs.
  useLayoutEffect(() => {
    if (userId) ensurePanelTabs(runtimeAccountKey(userId))
  }, [userId])
  useLayoutEffect(() => setPanelTabsEnabled(filesEnabled), [filesEnabled])

  useEffect(() => {
    // Writing against a stale location would replace the pending entry; wait for the router.
    if (!locationIsCurrent(location)) return
    const params = new URLSearchParams(location.search)
    const current = params.get(SIDE_PANEL_PARAM)
    // Read the store now, not the rendered value: a child effect in this same commit (a full page
    // taking over the panel's file) may already have closed it.
    const desired = serializePanelContent(useSidePanel.getState().content)
    if (current && current !== desired && current !== lastApplied.current) {
      const incoming = parsePanelContent(current)
      // The main view's own file or attachment is not opened beside it again (one view at a time);
      // the parameter is then rewritten from what the panel shows.
      if (incoming && !mainViewShows(incoming, location.pathname)) {
        lastApplied.current = current
        useSidePanel.getState().open(incoming)
        return
      }
      if (incoming) lastApplied.current = current
    }
    if (current === desired) {
      lastApplied.current = desired
      return
    }
    if (desired) params.set(SIDE_PANEL_PARAM, desired)
    else params.delete(SIDE_PANEL_PARAM)
    lastApplied.current = desired
    // `:` and `,` are valid in a query; keep the panel readable (`?side=chat:new:<id>,<id>`).
    const search = params.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',')
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state })
  }, [content, location, navigate])
}
