import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { SearchModal } from './SearchModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ChatDataBridge } from '@/features/chat/ChatDataBridge'
import { SettingsBridge } from '@/features/settings/SettingsBridge'
import { BannerBar } from './BannerBar'

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setCollapsed((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      <ChatDataBridge />
      <SettingsBridge />
      <div className="relative flex h-full overflow-hidden">
        <BannerBar />
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </TooltipProvider>
  )
}
