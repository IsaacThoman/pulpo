import { useEffect, useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import type { DesktopUpdateState } from '@/lib/runtime'
import { ui, uit } from '@/i18n/ui'

export function DesktopUpdateStatus({ separated = false }: { separated?: boolean }) {
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

  if (!ready) return null

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1.5 hover:text-foreground disabled:pointer-events-none"
        aria-label={restarting ? ui('Restarting…') : uit`Restart to install Pulpo v${ready.version}`}
        title={uit`Restart to install Pulpo v${ready.version}`}
        disabled={restarting}
        onClick={() => {
          const restartAndInstall = window.pulpoDesktop?.updates.restartAndInstall
          if (!restartAndInstall) return
          setRestarting(true)
          void restartAndInstall().catch(() => setRestarting(false))
        }}
      >
        {restarting ? (
          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        ) : (
          <ArrowDown aria-hidden="true" className="size-3" />
        )}
        {restarting ? ui('Restarting…') : ui('Update Available')}
      </button>
      {separated && <span aria-hidden="true">·</span>}
    </>
  )
}
