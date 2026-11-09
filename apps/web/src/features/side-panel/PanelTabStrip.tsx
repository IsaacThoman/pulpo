import { Maximize2 } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { TabStrip } from '@/features/files/tabs/TabStrip'
import { PanelWindowButtons } from './PanelControls'
import { PANEL_TAB_PANEL_ID, panelTabElementId } from './panel-strip'
import { panelTabActions, panelTabsData, useSidePanel, type PanelTab } from './store'
import { moveTabToMain, useMainNavigate } from './use-panel-actions'

/**
 * The side panel's tabs, at the top of the panel: like the main view's (see TabStrip), with the
 * panel's window buttons for the tab that shows at the end. Closing the last tab hides the panel.
 */
export function PanelTabStrip() {
  const tabs = useSidePanel((state) => state.tabs)
  const activeId = useSidePanel((state) => state.activeId)
  const closed = useSidePanel((state) => state.closed)
  const content = useSidePanel((state) => state.content)
  const goMain = useMainNavigate()

  // The tab moves to the main view, as the maximize button moves the tab that shows.
  const elsewhereItem = (tab: PanelTab) => (
    <DropdownMenuItem onSelect={() => moveTabToMain(tab, goMain)}><Maximize2 /> {ui("Open in main view")}</DropdownMenuItem>
  )

  return (
    <TabStrip
      tabs={tabs}
      activeId={activeId}
      closed={closed}
      read={panelTabsData}
      actions={panelTabActions}
      onSnapshots={panelTabActions.updateSnapshots}
      layout="panel"
      label={ui("Side panel tabs")}
      tabElementId={panelTabElementId}
      panelId={PANEL_TAB_PANEL_ID}
      elsewhereItem={elsewhereItem}
      trailing={content && <div className="flex shrink-0 items-center gap-0.5"><PanelWindowButtons content={content} strip /></div>}
    />
  )
}
