import { useEffect, useState } from 'react'
import { Loader2, WifiOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime, type DesktopUpdateState } from '@/lib/runtime'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { useAuth } from '@/stores/auth'
import { desktopConnectionStatus } from '@/lib/desktop-startup'
import { ui, uit } from '@/i18n/ui'

type DesktopConnectionStatusValue = 'connecting' | 'offline'

function DesktopStatusIndicator({
  status,
  onRetry,
}: {
  status?: DesktopConnectionStatusValue
  onRetry?: () => void
}) {
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({ status: 'idle' })
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    const updates = window.pulpoDesktop?.updates
    if (!updates) return
    let active = true
    let receivedEvent = false
    const applyState = (state: DesktopUpdateState) => {
      if (active) setUpdateState(state)
    }
    const unsubscribe = updates.onStateChanged((state) => {
      receivedEvent = true
      applyState(state)
    })
    void updates.getState().then((state) => {
      if (!receivedEvent) applyState(state)
    }).catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const className = 'desktop-connection-status fixed left-[84px] top-[19px] z-50 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-muted-foreground'

  if (status === 'connecting') {
    return (
      <div className={className} role="status">
        <Loader2 className="size-3 animate-spin" />
        {ui("Connecting…")}
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <button
        type="button"
        className={`${className} rounded-full px-2 py-1 hover:bg-accent hover:text-foreground`}
        onClick={onRetry}
      >
        <WifiOff className="size-3" />
        {ui("Offline · Retry")}
      </button>
    )
  }

  if (updateState.status === 'downloading') {
    return (
      <div className={className} role="status">
        <Loader2 className="size-3 animate-spin" />
        {ui("Downloading update…")}
      </div>
    )
  }

  if (updateState.status !== 'ready') return null
  return (
    <button
      type="button"
      title={uit`Restart to install Pulpo v${updateState.version}`}
      className={`${className} font-medium text-primary underline underline-offset-2 hover:text-primary/80 disabled:opacity-60`}
      disabled={restarting}
      onClick={() => {
        const restartAndInstall = window.pulpoDesktop?.updates.restartAndInstall
        if (!restartAndInstall) return
        setRestarting(true)
        void restartAndInstall().catch(() => setRestarting(false))
      }}
    >
      {restarting ? ui("Restarting…") : uit`Update to v${updateState.version}`}
    </button>
  )
}

export function DesktopTitleBarSurface({
  temporaryChat,
  connectionStatus,
  onRetry,
}: {
  temporaryChat: boolean
  connectionStatus?: DesktopConnectionStatusValue
  onRetry?: () => void
}) {
  return (
    <>
      <div
        aria-hidden="true"
        data-temporary-chat={temporaryChat ? 'true' : undefined}
        className="desktop-titlebar fixed inset-x-0 top-0 z-40 h-[38px] transition-colors duration-200"
      />
      <DesktopStatusIndicator status={connectionStatus} onRetry={onRetry} />
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
