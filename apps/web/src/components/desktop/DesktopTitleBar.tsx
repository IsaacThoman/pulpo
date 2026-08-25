import { useEffect } from 'react'
import { Loader2, WifiOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { useAuth } from '@/stores/auth'
import { desktopConnectionStatus } from '@/lib/desktop-startup'
import { DesktopUpdateLink } from './DesktopUpdateBanner'
import { ui } from '@/i18n/ui'

export function DesktopTitleBarSurface({
  temporaryChat,
  connectionStatus,
  onRetry,
}: {
  temporaryChat: boolean
  connectionStatus?: 'connecting' | 'offline'
  onRetry?: () => void
}) {
  return (
    <>
      <div
        aria-hidden="true"
        data-temporary-chat={temporaryChat ? 'true' : undefined}
        className="desktop-titlebar fixed inset-x-0 top-0 z-40 h-[38px] transition-colors duration-200"
      />
      <div className="desktop-connection-status fixed left-[84px] top-[21px] z-50 -translate-y-1/2">
        <DesktopUpdateLink hidden={connectionStatus === 'connecting'} />
      </div>
      {connectionStatus === 'connecting' && (
        <div className="desktop-connection-status fixed left-[84px] top-[19px] z-50 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
          <Loader2 className="size-3 animate-spin" />{ui("Connecting…")} </div>
      )}
      {connectionStatus === 'offline' && (
        <button
          type="button"
          className="desktop-connection-status fixed right-3 top-[19px] z-50 flex -translate-y-1/2 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onRetry}
        >
          <WifiOff className="size-3" />{ui("Offline · Retry")} </button>
      )}
    </>
  )
}

export function DesktopTitleBar() {
  const navigate = useNavigate()
  const temporaryChat = useDesktopChrome((state) => state.temporaryChat)
  const user = useAuth((state) => state.user)
  const checkingSession = useAuth((state) => state.checkingSession)
  const instanceReady = useAuth((state) => state.instanceReady)
  const retryDesktopConnection = useAuth((state) => state.retryDesktopConnection)

  useEffect(() => {
    if (!window.pulpoDesktop) return
    return window.pulpoDesktop.onCommand((command) => {
      if (command === 'new-chat') navigate('/')
      if (command === 'settings') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }))
      }
    })
  }, [navigate])

  useEffect(() => {
    if (!window.pulpoDesktop) return
    const retry = () => { void retryDesktopConnection() }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [retryDesktopConnection])

  if (!isDesktopRuntime()) return null
  const connectionStatus = desktopConnectionStatus({
    hasCachedUser: Boolean(user),
    checkingSession,
    instanceReady,
  })
  return (
    <DesktopTitleBarSurface
      temporaryChat={temporaryChat}
      connectionStatus={connectionStatus}
      onRetry={() => { void retryDesktopConnection() }}
    />
  )
}
