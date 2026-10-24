import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { ExternalLink, Loader2, Maximize2, PanelRight, PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { mainTabs, movePanelTabToMain, useMainTabs } from './main-tabs'
import { activeTab } from './pane-tabs'
import { PaneTabStrip } from './PaneTabStrip'
import { useSidePanel, type PanelContent } from './store'
import { isApplePlatform, panelShortcut } from './shortcuts'
import { panelContentPath, useMainNavigate } from './use-panel-actions'

function IconButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{shortcut ? `${label} · ${shortcut}` : label}</TooltipContent>
    </Tooltip>
  )
}

const MY_FILES: PanelContent = { kind: 'folder', id: null }

/** A browser tab with `content`; the desktop app has no tabs. */
function openInBrowserTab(content: PanelContent): void {
  window.open(panelContentPath(content), '_blank', 'noopener')
}

/**
 * The side panel's tabs along its top, with open in main view and close at the end. Things
 * opened to the side get a tab each (or the tab already showing them); closing the last tab
 * closes the panel.
 */
export function PanelTabStrip() {
  const tabs = useSidePanel((state) => state.tabs)
  const activeId = useSidePanel((state) => state.activeId)
  const go = useMainNavigate()
  const active = activeTab({ tabs, activeId })
  const panel = useSidePanel.getState()
  return (
    <PaneTabStrip
      label={ui("Side panel tabs")}
      className="side-panel-header"
      tabs={tabs}
      activeId={activeId}
      closeLast
      onSelect={(tab) => panel.activate(tab.id)}
      onClose={(ids) => panel.closeTabs(ids)}
      onMove={(id, index) => panel.moveTab(id, index)}
      onNew={() => panel.openTab(MY_FILES)}
      onDuplicate={(tab) => panel.openTab(tab.content, { after: tab.id })}
      menuItems={(tab) => (
        <>
          <DropdownMenuItem onSelect={() => movePanelTabToMain(tab, go)}><Maximize2 /> {ui("Open in main view")}</DropdownMenuItem>
          {!isDesktopRuntime() && <DropdownMenuItem onSelect={() => openInBrowserTab(tab.content)}><ExternalLink /> {ui("Open in new browser tab")}</DropdownMenuItem>}
        </>
      )}
      actions={(
        <>
          {active && (
            <IconButton label={ui("Open in main view")} shortcut={isApplePlatform ? '⌘⇧↵' : 'Ctrl+Shift+Enter'} onClick={() => movePanelTabToMain(active, go)}>
              <Maximize2 />
            </IconButton>
          )}
          <IconButton label={ui("Close panel")} shortcut={panelShortcut('\\')} onClick={() => panel.close()}><PanelRightClose /></IconButton>
        </>
      )}
    />
  )
}

/**
 * The main view's tabs along its top, over the Files and attachment views. Chats are not tabs;
 * while one is in the main view the tabs wait, and the sidebar's Files button comes back to them.
 */
function MainTabStrip() {
  const userId = useAuth((state) => state.user?.id)
  const owner = useMainTabs((state) => state.userId)
  const tabs = useMainTabs((state) => state.tabs)
  const activeId = useMainTabs((state) => state.activeId)
  const splitAvailable = useSidePanel((state) => state.splitAvailable)
  const go = useMainNavigate()
  if (!userId || owner !== userId || !tabs.length) return null
  const show = (content: PanelContent | undefined) => { if (content) go(panelContentPath(content)) }
  const close = (ids: string[]) => {
    const next = mainTabs.close(userId, ids)
    if (next.activeId !== activeId) show(activeTab(next)?.content)
  }
  return (
    <PaneTabStrip
      label={ui("Tabs")}
      className="main-pane-tabs"
      tabs={tabs}
      activeId={activeId}
      closeLast={false}
      onSelect={(tab) => {
        if (tab.id === activeId) return
        mainTabs.activate(userId, tab.id)
        show(tab.content)
      }}
      onClose={close}
      onMove={(id, index) => mainTabs.move(userId, id, index)}
      onNew={() => { mainTabs.add(userId, MY_FILES); show(MY_FILES) }}
      onDuplicate={(tab) => { mainTabs.add(userId, tab.content, { after: tab.id }); show(tab.content) }}
      menuItems={(tab) => (
        <>
          {splitAvailable && (
            <DropdownMenuItem
              onSelect={() => {
                // The tab moves to the side panel; the main view shows the next tab, or a new chat
                // beside the last one, as Split view does.
                useSidePanel.getState().open(tab.content)
                if (tabs.length > 1) close([tab.id])
                else { mainTabs.close(userId, [tab.id]); go('/') }
              }}
            >
              <PanelRight /> {ui("Move to side panel")}
            </DropdownMenuItem>
          )}
          {!isDesktopRuntime() && <DropdownMenuItem onSelect={() => openInBrowserTab(tab.content)}><ExternalLink /> {ui("Open in new browser tab")}</DropdownMenuItem>}
        </>
      )}
    />
  )
}

/** Routes the main view shows in tabs: the tabs along the top, the active tab's view below. */
export function MainTabsLayout() {
  return (
    <div className="main-pane-tabs-layout flex h-full min-h-0 flex-col">
      <MainTabStrip />
      <div className="min-h-0 flex-1">
        {/* The tabs stay while a view loads. */}
        <Suspense fallback={<div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
