import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { useDesktopChrome } from '@/stores/desktopChrome'

export function DesktopTitleBarSurface({ temporaryChat }: { temporaryChat: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-temporary-chat={temporaryChat ? 'true' : undefined}
      className="desktop-titlebar fixed inset-x-0 top-0 z-40 h-[38px] transition-colors duration-200"
    />
  )
}

export function DesktopTitleBar() {
  const navigate = useNavigate()
  const temporaryChat = useDesktopChrome((state) => state.temporaryChat)

  useEffect(() => {
    if (!window.pulpoDesktop) return
    return window.pulpoDesktop.onCommand((command) => {
      if (command === 'new-chat') navigate('/')
      if (command === 'settings') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }))
      }
    })
  }, [navigate])

  if (!isDesktopRuntime()) return null
  return <DesktopTitleBarSurface temporaryChat={temporaryChat} />
}
