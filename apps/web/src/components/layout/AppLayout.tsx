import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PanelLeftOpen } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import {
  applySidebarWidth,
  clampSidebarWidth,
  readSidebarWidth,
  SIDEBAR_COLLAPSED_WIDTH,
  sidebarMaxWidth,
  writeSidebarWidth,
} from './sidebar-width'
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
import { SidePanelLayout } from '@/features/side-panel/SidePanelLayout'
import { splitFits, useSidePanel } from '@/features/side-panel/store'
import { FileToasts } from '@/features/files/browser/FileToasts'
import { useSidePanelUrl } from '@/features/side-panel/use-side-panel-url'
import { DesktopTabKeys } from './DesktopTabKeys'

const SearchModal = lazy(() => import('./SearchModal').then((module) => ({ default: module.SearchModal })))
const SettingsModal = lazy(() => import('@/components/settings/SettingsModal').then((module) => ({ default: module.SettingsModal })))

/** Rich-text editors (Files documents) own formatting shortcuts such as Cmd/Ctrl+B. */
function isRichTextTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'))
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** The elements Tab reaches in `root`, in order. */
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => (
    element.tabIndex >= 0 && !element.closest('[inert]')
    // Shown: not display: none (directly or by an ancestor) or visibility: hidden.
    && (typeof element.checkVisibility !== 'function' || element.checkVisibility({ visibilityProperty: true }))
  ))
}

/**
 * "Skip to message" on chats, else "Skip to main content": past the sidebar's long chat list.
 * A full-screen side panel hides the main view, so the link goes to the panel instead.
 */
function SkipLink({ chatView, panelFull, inert }: { chatView: boolean; panelFull: boolean; inert: boolean }) {
  return (
    <a
      href={panelFull ? '#side-panel' : '#main-content'}
      inert={inert}
      className="sr-only rounded-lg border bg-popover text-sm font-medium text-popover-foreground shadow-lg outline-none focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:px-3 focus:py-2 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(event) => {
        event.preventDefault()
        if (panelFull) {
          const panel = document.querySelector<HTMLElement>('aside[data-side-panel]')
          if (!panel) return
          const first = tabbables(panel)[0]
          if (first) first.focus()
          else {
            panel.tabIndex = -1
            panel.focus()
          }
          return
        }
        const main = document.getElementById('main-content')
        const composer = chatView ? main?.querySelector<HTMLTextAreaElement>('textarea:not([disabled])') : null
        if (composer) composer.focus()
        else main?.focus()
      }}
    >
      {panelFull ? ui("Skip to side panel") : chatView ? ui("Skip to message") : ui("Skip to main content")}
    </a>
  )
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 750px)').matches)
  // The whole frame, sidebar included; unlike the content area it does not change as the sidebar animates.
  const [frameWidth, setFrameWidth] = useState(() => window.innerWidth)
  const frameRef = useRef<HTMLDivElement>(null)
  const panelOpen = useSidePanel((state) => state.content !== null)
  // Set when the user reopens a sidebar that was folded away for the panel: the sidebar wins.
  const [keepSidebar, setKeepSidebar] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarTransitions, setSidebarTransitions] = useState(true)
  // The open desktop sidebar's width is kept as set; what shows is clamped to the room there is now.
  const [preferredSidebarWidth, setPreferredSidebarWidth] = useState(readSidebarWidth)
  const sidebarWidth = clampSidebarWidth(preferredSidebarWidth, frameWidth)
  // Set while a drag on its edge sizes the sidebar directly, without its transitions.
  const [sidebarTracking, setSidebarTracking] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general')
  const doubleShiftSearch = useSettings((state) => state.doubleShiftSearch)
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const setDesktopSidebarVisible = useDesktopChrome((state) => state.setDesktopSidebarVisible)
  const location = useLocation()
  const adminChatView = location.pathname.startsWith('/admin/chats/')
  const chatView = location.pathname === '/' || location.pathname.startsWith('/c/')
  // On phones the open sidebar is a modal drawer: everything behind it is inert.
  const drawerOpen = mobile && mobileOpen && !adminChatView
  const drawerOpenerRef = useRef<HTMLButtonElement>(null)
  // What had focus when the drawer opened, to return to when it closes.
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null)
  const toggleDrawer = () => {
    if (!mobileOpen && document.activeElement instanceof HTMLElement) drawerReturnFocusRef.current = document.activeElement
    setMobileOpen((open) => !open)
  }
  const toggleDrawerRef = useRef(toggleDrawer)
  toggleDrawerRef.current = toggleDrawer
  // An open side panel that fits only without the sidebar folds the sidebar away (without changing
  // the user's own choice), so the sidebar gives way before the panel does. It returns once there
  // is room again or the panel closes.
  const panelNeedsRoomFrom = (width: number) => panelOpen && !adminChatView
    && !splitFits(frameWidth - width) && splitFits(frameWidth - SIDEBAR_COLLAPSED_WIDTH)
  const panelNeedsSidebarRoom = panelNeedsRoomFrom(sidebarWidth)
  const sidebarMakesRoom = !mobile && !collapsed && !keepSidebar && panelNeedsSidebarRoom
  const sidebarCollapsed = mobile || collapsed || sidebarMakesRoom
  useEffect(() => { if (!panelNeedsSidebarRoom) setKeepSidebar(false) }, [panelNeedsSidebarRoom])
  // Too narrow for two views even without the sidebar (phones): the panel becomes the only view,
  // in the layout rather than over it; the main view stays mounted and returns when it closes.
  const panelFull = panelOpen && !adminChatView && (mobile || !splitFits(frameWidth - SIDEBAR_COLLAPSED_WIDTH))
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
  const setDesktopSidebarOpen = (open: boolean) => {
    if (open === sidebarCollapsed) toggleDesktopSidebar()
  }
  const changeSidebarWidth = (width: number) => {
    setPreferredSidebarWidth(width)
    writeSidebarWidth(width)
    // Widened past the room an open panel needs, the sidebar keeps its width and the panel waits.
    if (panelNeedsRoomFrom(clampSidebarWidth(width, frameWidth))) setKeepSidebar(true)
  }
  const sidebarTransitionsActive = sidebarTransitions && !sidebarTracking
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
    const frame = frameRef.current
    if (!frame) return
    const measure = () => setFrameWidth(frame.clientWidth)
    measure()
    // Only observe the outer frame here. The space beside the animated sidebar changes every
    // frame; measuring it in this component would rerender the entire chat list on every tick.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    applySidebarWidth(sidebarWidth)
  }, [sidebarWidth])

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
      // Every key counts toward double-Shift (any other key resets it), even ones handled already.
      const doubleShift = doubleShiftSearch && handleDoubleShiftKeyDown(doubleShiftRef.current, e, performance.now())
      // A key something on the page already handled (an editor's Cmd/Ctrl+B for bold) is not a shortcut.
      if (e.defaultPrevented) return
      if (doubleShift) {
        e.preventDefault()
        setMobileOpen(false)
        setSearchOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !isRichTextTarget(e.target)) {
        e.preventDefault()
        if (window.matchMedia('(width < 750px)').matches) toggleDrawerRef.current()
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
      // Escape that closed a menu or dialog inside the drawer leaves the drawer open.
      if (event.key === 'Escape' && !event.defaultPrevented) setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  // The open drawer takes focus, keeps Tab inside it, and gives focus back when it closes.
  useEffect(() => {
    if (!drawerOpen) return
    const opener = drawerReturnFocusRef.current
    const drawerOpener = drawerOpenerRef.current
    const drawer = () => frameRef.current?.querySelector<HTMLElement>(':scope > aside') ?? null
    const focusFirst = requestAnimationFrame(() => {
      const panel = drawer()
      if (panel && !panel.contains(document.activeElement)) tabbables(panel)[0]?.focus()
    })
    const trapTab = (event: KeyboardEvent) => {
      const panel = drawer()
      if (event.key !== 'Tab' || event.defaultPrevented || !panel) return
      const items = tabbables(panel)
      if (!items.length) return
      const first = items[0]!, last = items.at(-1)!
      const active = document.activeElement
      // A dialog or menu opened from the drawer renders in a portal and traps focus itself.
      if (active && !panel.contains(active) && active.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapTab)
    return () => {
      cancelAnimationFrame(focusFirst)
      document.removeEventListener('keydown', trapTab)
      // Focus lost with the drawer (it is inert once closed) goes back to what opened it. Focus a
      // view moved on its own (a newly opened chat's composer) stays where it is.
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active && active !== document.body && !drawer()?.contains(active)) return
        const target = opener && opener !== document.body && opener.isConnected && !opener.closest('[inert]') ? opener : drawerOpener
        target?.focus()
        drawerReturnFocusRef.current = null
      })
    }
  }, [drawerOpen])

  return (
    <SettingsDialogProvider controller={settingsController}>
      <TooltipProvider delayDuration={1000}>
        <SkipLink chatView={chatView} panelFull={panelFull} inert={drawerOpen} />
        <ChatDataBridge />
        <SettingsBridge />
        {/* Tab keys for the main view's Files tabs and the side panel's, in the desktop app. */}
        {!adminChatView && <DesktopTabKeys panelFull={panelFull} />}
        <DesktopSidebarTitleBar
          collapsed={sidebarCollapsed}
          compact={mobile}
          transitions={sidebarTransitionsActive}
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
          {!adminChatView && <button
            ref={drawerOpenerRef}
            inert={drawerOpen}
            className="mobile-sidebar-opener absolute left-2 top-2 z-[21] size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-accent"
            onClick={toggleDrawer}
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
              // A pointer target only: the drawer's own Collapse button and Escape close it from the keyboard.
              aria-hidden
              tabIndex={-1}
            />
          )}
          {!adminChatView && <Sidebar
            collapsed={mobile ? false : sidebarCollapsed}
            mobile={mobile}
            mobileOpen={mobileOpen}
            transitions={sidebarTransitionsActive}
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
          {!adminChatView && !mobile && <SidebarResizeHandle
            width={sidebarWidth}
            maxWidth={sidebarMaxWidth(frameWidth)}
            collapsed={sidebarCollapsed}
            animationSpeed={animationSpeed}
            onTrackingChange={setSidebarTracking}
            onOpenChange={setDesktopSidebarOpen}
            onWidthChange={changeSidebarWidth}
          />}
          {/* `contents` keeps the layout; inert hides the page behind the open drawer. */}
          <div className="contents" inert={drawerOpen}>
          <SidePanelLayout mobile={mobile} full={panelFull} enabled={!adminChatView}>
            <main id="main-content" tabIndex={-1} className={cn('app-main relative min-w-0 flex-1 overflow-hidden outline-none', panelFull && 'hidden')}>
              <BannerBar />
              <Suspense fallback={<div className="h-full bg-background" aria-label={ui("Loading view")} />}>
                <Outlet />
              </Suspense>
            </main>
          </SidePanelLayout>
          </div>
          {/* One host for Files undo toasts, whether Files is on the page or in the panel. */}
          {!adminChatView && <FileToasts />}
        </div>
        {searchOpen && <Suspense fallback={null}>
          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
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
