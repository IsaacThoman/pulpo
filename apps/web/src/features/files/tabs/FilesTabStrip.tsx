import { PanelRight } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { useSidePanel } from '@/features/side-panel/store'
import { openBeside, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { updateSnapshots, type FilesTab, type TabSnapshot } from './model'
import { FILES_TAB_PANEL_ID, filesTabElementId, type FilesTabActions } from './routing'
import { filesTabsData, updateFilesTabs, useFilesTabs } from './store'
import { TabStrip } from './TabStrip'

function saveSnapshots(nodes: ReadonlyMap<string, TabSnapshot>): void {
  updateFilesTabs((data) => updateSnapshots(data, nodes))
}

/**
 * The main view's Files tabs: each tab keeps its own place in Files, and the view below shows
 * the active tab's (see TabStrip). The tab menu's "Open to the right" shows a tab's place in the
 * side panel.
 */
export function FilesTabStrip({ actions }: { actions: FilesTabActions }) {
  const tabs = useFilesTabs((state) => state.tabs)
  const activeId = useFilesTabs((state) => state.activeId)
  const closed = useFilesTabs((state) => state.closed)
  const goMain = useMainNavigate()
  const splitAvailable = useSidePanel((state) => state.splitAvailable)

  const elsewhereItem = (tab: FilesTab) => {
    // The active tab's file is already open here; one file opens in one view at a time.
    if (!splitAvailable || (tab.id === activeId && tab.location.kind === 'file')) return null
    return <DropdownMenuItem onSelect={() => openBeside(tab.location, goMain, tab.snapshot)}><PanelRight /> {ui("Open to the right")}</DropdownMenuItem>
  }

  return (
    <TabStrip
      tabs={tabs}
      activeId={activeId}
      closed={closed}
      read={filesTabsData}
      actions={actions}
      onSnapshots={saveSnapshots}
      layout="page"
      label={ui("Files tabs")}
      tabElementId={filesTabElementId}
      panelId={FILES_TAB_PANEL_ID}
      elsewhereItem={elsewhereItem}
      titlesPage
    />
  )
}
