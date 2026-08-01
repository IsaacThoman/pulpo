import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { SearchModal } from './SearchModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ChatDataBridge } from '@/features/chat/ChatDataBridge'
import { SettingsBridge } from '@/features/settings/SettingsBridge'
import { BannerBar } from './BannerBar'

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 750px)').matches)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const query = window.matchMedia('(width < 750px)')
    const update = () => {
      setMobile(query.matches)
      if (!query.matches) setMobileOpen(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

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
          <img src="/pulpo-smiley.png" alt="" className="size-6" />
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
          collapsed={mobile ? false : collapsed}
          mobile={mobile}
          mobileOpen={mobileOpen}
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
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </TooltipProvider>
  )
}
