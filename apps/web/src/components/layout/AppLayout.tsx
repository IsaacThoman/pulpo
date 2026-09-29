import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PanelLeftOpen } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from './Sidebar'
import { SettingsDialogProvider, type SettingsSectionId } from '@/components/settings/settings-dialog'
import { ChatDataBridge } from '@/features/chat/ChatDataBridge'
import { SettingsBridge } from '@/features/settings/SettingsBridge'
import { BannerBar } from './BannerBar'
import { useChat } from '@/stores/chat'
import { DesktopSidebarTitleBar } from '@/components/desktop/DesktopSidebarTitleBar'
import { cn } from '@/lib/utils'
import { handleDoubleShiftKeyDown, type DoubleShiftState } from '@/lib/double-shift'
import { ui } from '@/i18n/ui'
import { useSettings } from '@/stores/settings'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { isDesktopRuntime } from '@/lib/runtime'
import { SidePanel } from '@/features/side-panel/SidePanel'
import { splitFits, useSidePanel } from '@/features/side-panel/store'
import { FileToasts } from '@/features/files/browser/FileToasts'
import { useSidePanelUrl } from '@/features/side-panel/use-side-panel-url'

const SearchModal = lazy(() => import('./SearchModal').then((module) => ({ default: module.SearchModal })))
const SettingsModal = lazy(() => import('@/components/settings/SettingsModal').then((module) => ({ default: module.SettingsModal })))

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 750px)').matches)
  // The room beside the sidebar that the main view and the side panel share.
  const [contentWidth, setContentWidth] = useState(() => window.innerWidth)
  const contentRef = useRef<HTMLDivElement>(null)
  // The whole frame, sidebar included; unlike the content area it does not change as the sidebar animates.
  const [frameWidth, setFrameWidth] = useState(() => window.innerWidth)
  const frameRef = useRef<HTMLDivElement>(null)
  const panelOpen = useSidePanel((state) => state.content !== null)
  // Set when the user reopens a sidebar that was folded away for the panel: the sidebar wins.
  const [keepSidebar, setKeepSidebar] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarTransitions, setSidebarTransitions] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHasQuery, setSearchHasQuery] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general')
  const doubleShiftSearch = useSettings((state) => state.doubleShiftSearch)
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const setDesktopSidebarVisible = useDesktopChrome((state) => state.setDesktopSidebarVisible)
  const location = useLocation()
  const adminChatView = location.pathname.startsWith('/admin/chats/')
  // An open side panel that fits only without the sidebar folds the sidebar away (without changing
  // the user's own choice), so the sidebar gives way before the panel does. It returns once there
  // is room again or the panel closes.
  const panelNeedsSidebarRoom = panelOpen && !adminChatView
    && !splitFits(frameWidth - SIDEBAR_WIDTH) && splitFits(frameWidth - SIDEBAR_COLLAPSED_WIDTH)
  const sidebarMakesRoom = !mobile && !collapsed && !searchHasQuery && !keepSidebar && panelNeedsSidebarRoom
  const sidebarCollapsed = mobile || collapsed || searchHasQuery || sidebarMakesRoom
  useEffect(() => { if (!panelNeedsSidebarRoom) setKeepSidebar(false) }, [panelNeedsSidebarRoom])
  /** The desktop sidebar toggle, aware of a sidebar folded away for the panel. */
  const toggleDesktopSidebar = () => {
    // Reopening a folded-away sidebar keeps it open, and hides the panel, until there is room.
    if (sidebarMakesRoom) setKeepSidebar(true)
    // Closing it again hands the room back to the panel.
    else if (keepSidebar && !collapsed) setKeepSidebar(false)
    else setCollapsed((v) => !v)
  }
  const toggleDesktopSidebarRef = useRef(toggleDesktopSidebar)
  toggleDesktopSidebarRef.current = toggleDesktopSidebar
  const desktopTitleBarVisible = isDesktopRuntime() && !adminChatView
  const mainUsesDesktopTitleBar = !mobile && !sidebarCollapsed
  const previousPathRef = useRef(location.pathname)
  const doubleShiftRef = useRef<DoubleShiftState>({ lastPressAt: null })
  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
    setSettingsMounted(true)
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])
  const settingsController = useMemo(() => ({ openSettings }), [openSettings])

  useEffect(() => {
    const previousPath = previousPathRef.current
    previousPathRef.current = location.pathname
    if (previousPath === '/' && location.pathname !== '/') {
      useChat.getState().abandonTemporaryChat()
    }
  }, [location.pathname])

  useEffect(() => {
    const query = window.matchMedia('(width < 750px)')
    const update = () => {
      setSidebarTransitions(false)
      setMobile(query.matches)
      if (query.matches) setCollapsed(true)
      else setMobileOpen(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useSidePanelUrl()

  useLayoutEffect(() => {
    const content = contentRef.current
    const frame = frameRef.current
    if (!content || !frame) return
    const measure = () => {
      setContentWidth(content.clientWidth)
      setFrameWidth(frame.clientWidth)
    }
    measure()
    // The sidebar collapsing changes the room without resizing the window, hence the observer.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])
  // Phones never split; elsewhere the panel shows only beside a main view of usable width.
  const splitRoom = mobile ? 0 : contentWidth
  useEffect(() => { useSidePanel.setState({ splitAvailable: splitFits(splitRoom) }) }, [splitRoom])

  useEffect(() => {
    if (sidebarTransitions) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSidebarTransitions(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [sidebarTransitions])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (doubleShiftSearch && handleDoubleShiftKeyDown(doubleShiftRef.current, e, performance.now())) {
        e.preventDefault()
        setMobileOpen(false)
        setSearchOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        if (window.matchMedia('(width < 750px)').matches) setMobileOpen((v) => !v)
        else toggleDesktopSidebarRef.current()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        openSettings('general')
      }
    }
    const resetDoubleShift = () => {
      doubleShiftRef.current.lastPressAt = null
    }
    window.addEventListener('keydown', handler)
    window.addEventListener('blur', resetDoubleShift)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('blur', resetDoubleShift)
    }
  }, [doubleShiftSearch, openSettings])

  useEffect(() => {
    if (!doubleShiftSearch) doubleShiftRef.current.lastPressAt = null
  }, [doubleShiftSearch])

  useLayoutEffect(() => {
    setDesktopSidebarVisible(desktopTitleBarVisible)
    return () => setDesktopSidebarVisible(false)
  }, [desktopTitleBarVisible, setDesktopSidebarVisible])

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  return (
    <SettingsDialogProvider controller={settingsController}>
      <TooltipProvider delayDuration={1000}>
        <ChatDataBridge />
        <SettingsBridge />
        <DesktopSidebarTitleBar
          collapsed={sidebarCollapsed}
          compact={mobile}
          transitions={sidebarTransitions}
          visible={desktopTitleBarVisible}
          animationSpeed={animationSpeed}
        />
        <div
          ref={frameRef}
          className={cn(
            'app-layout-frame relative flex h-full overflow-hidden',
            mainUsesDesktopTitleBar && 'desktop-main-titlebar-active',
            !adminChatView && sidebarCollapsed && 'desktop-sidebar-collapsed',
          )}
        >
          <BannerBar />
          {!adminChatView && <button
            className="mobile-sidebar-opener absolute left-2 top-2 z-[21] size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={ui("Open sidebar")}
            aria-expanded={mobileOpen}
          >
            <PanelLeftOpen className="size-5" />
          </button>}
          {!adminChatView && mobile && (
            <button
              className={`mobile-sidebar-backdrop fixed inset-0 z-30 bg-black/55 transition-opacity duration-200 ${
                mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              onClick={() => setMobileOpen(false)}
              aria-label={ui("Close sidebar")}
              aria-hidden={!mobileOpen}
              tabIndex={mobileOpen ? 0 : -1}
            />
          )}
          {!adminChatView && <Sidebar
            collapsed={mobile ? false : sidebarCollapsed}
            mobile={mobile}
            mobileOpen={mobileOpen}
            transitions={sidebarTransitions}
            onToggle={() => mobile ? setMobileOpen(false) : toggleDesktopSidebar()}
            onNavigate={() => setMobileOpen(false)}
            onOpenSearch={() => {
              setMobileOpen(false)
              setSearchOpen(true)
            }}
            onOpenSettings={() => {
              setMobileOpen(false)
              openSettings('general')
            }}
          />}
          <div ref={contentRef} className="flex h-full min-w-0 flex-1">
            <main className="app-main min-w-0 flex-1 overflow-hidden">
              <Suspense fallback={<div className="h-full bg-background" aria-label={ui("Loading view")} />}>
                <Outlet />
              </Suspense>
            </main>
            {!adminChatView && <SidePanel available={splitRoom} />}
          </div>
          {/* One host for Files undo toasts, whether Files is on the page or in the panel. */}
          {!adminChatView && <FileToasts />}
        </div>
        {searchOpen && <Suspense fallback={null}>
          <SearchModal
            open={searchOpen}
            onClose={() => {
              setSearchOpen(false)
              setSearchHasQuery(false)
            }}
            onQueryPresenceChange={setSearchHasQuery}
          />
        </Suspense>}
        {settingsMounted && <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            initialSection={settingsSection}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>}
      </TooltipProvider>
    </SettingsDialogProvider>
  )
}
