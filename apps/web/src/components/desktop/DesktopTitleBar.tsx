import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { ui } from '@/i18n/ui'

function DesktopWindowControls() {
  const controls = window.pulpoDesktop?.windowControls
  const windows = window.pulpoDesktop?.os === 'win32'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!windows || !controls) return
    let active = true
    const unsubscribe = controls.onMaximizedChanged((next) => {
      if (active) setMaximized(next)
    })
    void controls.isMaximized().then((next) => {
      if (active) setMaximized(next)
    }).catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [controls, windows])

  if (!windows || !controls) return null

  return (
    <div className="desktop-window-controls desktop-no-drag pointer-events-auto fixed right-0 top-0 z-[60] flex h-[38px]">
      <button
        type="button"
        aria-label={ui("Minimize")}
        className="flex h-[38px] w-[46px] items-center justify-center text-foreground/80 hover:bg-foreground/10 hover:text-foreground"
        onClick={() => { void controls.minimize() }}
      >
        <Minus className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={maximized ? ui("Restore") : ui("Maximize")}
        className="flex h-[38px] w-[46px] items-center justify-center text-foreground/80 hover:bg-foreground/10 hover:text-foreground"
        onClick={() => {
          void controls.toggleMaximize().then(setMaximized).catch(() => undefined)
        }}
      >
        {maximized
          ? <Copy className="size-3.5" strokeWidth={1.5} />
          : <Square className="size-3" strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        aria-label={ui("Close")}
        className="flex h-[38px] w-[46px] items-center justify-center text-foreground/80 hover:bg-[#c42b1c] hover:text-white"
        onClick={() => { void controls.close() }}
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}

export function DesktopTitleBarSurface({
  temporaryChat,
}: {
  temporaryChat: boolean
}) {
  return (
    <>
      <div
        aria-hidden="true"
        data-temporary-chat={temporaryChat ? 'true' : undefined}
        className="desktop-titlebar fixed inset-x-0 top-0 z-[42] h-[38px] transition-colors duration-200"
      />
      <DesktopWindowControls />
    </>
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
