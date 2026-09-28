import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { parsePanelContent, serializePanelContent, SIDE_PANEL_PARAM, useSidePanel } from './store'

/**
 * Mirrors the side panel into the URL so reloads and shared links reopen it. The panel belongs
 * to the window, not the page: navigating the main view carries the parameter along, while a URL
 * that arrives with a different panel (a link, back/forward) opens that content instead.
 */
export function useSidePanelUrl(): void {
  const location = useLocation()
  const navigate = useNavigate()
  const content = useSidePanel((state) => state.content)
  const lastApplied = useRef<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const current = params.get(SIDE_PANEL_PARAM)
    // Read the store now, not the rendered value: a child effect in this same commit (a full page
    // taking over the panel's file) may already have closed it.
    const desired = serializePanelContent(useSidePanel.getState().content)
    if (current && current !== desired && current !== lastApplied.current) {
      const incoming = parsePanelContent(current)
      if (incoming) {
        lastApplied.current = current
        useSidePanel.getState().open(incoming)
        return
      }
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
  }, [content, location.hash, location.pathname, location.search, location.state, navigate])
}
