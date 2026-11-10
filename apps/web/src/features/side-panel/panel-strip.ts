import { createContext, useContext } from 'react'

/** The panel's view, below its tabs. */
export const PANEL_TAB_PANEL_ID = 'side-panel-tab-panel'
export const panelTabElementId = (id: string): string => `panel-tab-${id}`

/**
 * Set while the panel shows its strip of tabs, which carries the panel's window buttons; the
 * views' own headers then leave them out. Without it (Files turned off) the headers keep them.
 */
export const PanelStripContext = createContext(false)

export function usePanelStripShown(): boolean {
  return useContext(PanelStripContext)
}
