import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PanelLeftOpen } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { SearchModal } from './SearchModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ChatDataBridge } from '@/features/chat/ChatDataBridge'
import { SettingsBridge } from '@/features/settings/SettingsBridge'
import { BannerBar } from './BannerBar'
import { useChat } from '@/stores/chat'

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarTransitions, setSidebarTransitions] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHasQuery, setSearchHasQuery] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const location = useLocation()
  const previousPathRef = useRef(location.pathname)

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
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  return (
    <TooltipProvider delayDuration={200}>
      <ChatDataBridge />
      <SettingsBridge />
      <div className="relative flex h-full overflow-hidden">
        <BannerBar />
        <button
          className="mobile-sidebar-opener absolute left-2 top-2 z-20 size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-accent"
          onClick={() => setMobileOpen(true)}
          aria-label="Open sidebar"
          aria-expanded={mobileOpen}
        >
          <PanelLeftOpen className="size-5" />
        </button>
        {mobile && (
          <button
            className={`fixed inset-0 z-30 bg-black/55 transition-opacity duration-200 ${
              mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
            aria-hidden={!mobileOpen}
            tabIndex={mobileOpen ? 0 : -1}
          />
        )}
        <Sidebar
          collapsed={mobile ? false : collapsed || searchHasQuery}
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
            setSettingsOpen(true)
          }}
        />
        <main className="app-main min-w-0 flex-1 overflow-hidden">
          <Outlet />
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
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </TooltipProvider>
  )
}
