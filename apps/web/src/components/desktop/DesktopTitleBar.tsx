import { useEffect } from 'react'
import { Loader2, WifiOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { useAuth } from '@/stores/auth'
import { desktopConnectionStatus } from '@/lib/desktop-startup'
import { ui } from '@/i18n/ui'
import { DesktopUpdateStatus } from './DesktopUpdateStatus'

const DESKTOP_CONNECTION_RETRY_INTERVAL_MS = 10_000

export function DesktopTitleBarSurface({
  temporaryChat,
  connectionStatus,
}: {
  temporaryChat: boolean
  connectionStatus?: 'connecting' | 'offline'
}) {
  return (
    <>
      <div
        aria-hidden="true"
        data-temporary-chat={temporaryChat ? 'true' : undefined}
        className="desktop-titlebar fixed inset-x-0 top-0 z-40 h-[38px] transition-colors duration-200"
      />
      <div className="desktop-connection-status fixed left-[84px] top-[19px] z-50 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-muted-foreground">
        <DesktopUpdateStatus separated={Boolean(connectionStatus)} />
        {connectionStatus && (
          <span className="flex items-center gap-1.5" role="status">
            {connectionStatus === 'connecting' ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                {ui('Connecting…')}
              </>
            ) : (
              <>
                <WifiOff className="size-3" />
                {ui('Offline')}
              </>
            )}
          </span>
        )}
      </div>
    </>
  )
}

export function DesktopTitleBar() {
  const navigate = useNavigate()
  const temporaryChat = useDesktopChrome((state) => state.temporaryChat)
  const user = useAuth((state) => state.user)
  const checkingSession = useAuth((state) => state.checkingSession)
  const instanceReady = useAuth((state) => state.instanceReady)
  const instanceError = useAuth((state) => state.instanceError)
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

  useEffect(() => {
    if (
      !window.pulpoDesktop
      || !user
      || checkingSession
      || instanceReady
      || !navigator.onLine
    ) return

    const timeout = window.setTimeout(() => {
      void retryDesktopConnection()
    }, DESKTOP_CONNECTION_RETRY_INTERVAL_MS)
    return () => window.clearTimeout(timeout)
  }, [checkingSession, instanceReady, retryDesktopConnection, user])

  if (!isDesktopRuntime()) return null
  const connectionStatus = desktopConnectionStatus({
    hasCachedUser: Boolean(user),
    checkingSession,
    instanceReady,
    hasConnectionError: Boolean(instanceError),
  })
  return (
    <DesktopTitleBarSurface
      temporaryChat={temporaryChat}
      connectionStatus={connectionStatus}
    />
  )
}
