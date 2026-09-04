import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PanelLeftOpen } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { SearchModal } from './SearchModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
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

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarTransitions, setSidebarTransitions] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHasQuery, setSearchHasQuery] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general')
  const doubleShiftSearch = useSettings((state) => state.doubleShiftSearch)
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const setDesktopSidebarVisible = useDesktopChrome((state) => state.setDesktopSidebarVisible)
  const location = useLocation()
  const adminChatView = location.pathname.startsWith('/admin/chats/')
  const sidebarCollapsed = collapsed || searchHasQuery
  const mainUsesDesktopTitleBar = !mobile && !sidebarCollapsed
  const previousPathRef = useRef(location.pathname)
  const doubleShiftRef = useRef<DoubleShiftState>({ lastPressAt: null })
  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
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
        else setCollapsed((v) => !v)
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
    const desktopSidebarVisible = isDesktopRuntime() && !mobile
    setDesktopSidebarVisible(desktopSidebarVisible)
    return () => setDesktopSidebarVisible(false)
  }, [mobile, setDesktopSidebarVisible])

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
          transitions={sidebarTransitions}
          visible={!mobile && !adminChatView}
          animationSpeed={animationSpeed}
        />
        <div
          className={cn(
            'app-layout-frame relative flex h-full overflow-hidden',
            mainUsesDesktopTitleBar && 'desktop-main-titlebar-active',
            !mobile && sidebarCollapsed && 'desktop-sidebar-collapsed',
          )}
        >
          <BannerBar />
          {!adminChatView && <button
            className="mobile-sidebar-opener absolute left-2 top-2 z-20 size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => setMobileOpen(true)}
            aria-label={ui("Open sidebar")}
            aria-expanded={mobileOpen}
          >
            <PanelLeftOpen className="size-5" />
          </button>}
          {!adminChatView && mobile && (
            <button
              className={`fixed inset-0 z-30 bg-black/55 transition-opacity duration-200 ${
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
            onToggle={() => mobile ? setMobileOpen(false) : setCollapsed((v) => !v)}
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
          <main className="app-main min-w-0 flex-1 overflow-hidden">
            <Suspense fallback={<div className="h-full bg-background" aria-label={ui("Loading view")} />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <SearchModal
          open={searchOpen}
          onClose={() => {
            setSearchOpen(false)
            setSearchHasQuery(false)
          }}
          onQueryPresenceChange={setSearchHasQuery}
        />
        <SettingsModal
          open={settingsOpen}
          initialSection={settingsSection}
          onClose={() => setSettingsOpen(false)}
        />
      </TooltipProvider>
    </SettingsDialogProvider>
  )
}
