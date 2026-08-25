import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@/lib/runtime'
import { ui, uit } from '@/i18n/ui'

export function DesktopUpdateLink({ hidden = false }: { hidden?: boolean }) {
  const [ready, setReady] = useState<Extract<DesktopUpdateState, { status: 'ready' }> | null>(null)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    const updates = window.pulpoDesktop?.updates
    if (!updates) return
    let active = true
    let receivedEvent = false
    const applyState = (state: DesktopUpdateState) => {
      if (active) setReady(state.status === 'ready' ? state : null)
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

  if (!ready || hidden) return null
  return (
    <button
      type="button"
      title={uit`Restart to install Pulpo v${ready.version}`}
      className="desktop-connection-status fixed left-[84px] top-[19px] z-50 -translate-y-1/2 text-[11px] font-medium text-primary underline underline-offset-2 hover:text-primary/80 disabled:opacity-60"
      disabled={restarting}
      onClick={() => {
        const restartAndInstall = window.pulpoDesktop?.updates.restartAndInstall
        if (!restartAndInstall) return
        setRestarting(true)
        void restartAndInstall().catch(() => setRestarting(false))
      }}
    >
      {restarting ? ui("Restarting…") : uit`Update to v${ready.version}`}
    </button>
  )
}
