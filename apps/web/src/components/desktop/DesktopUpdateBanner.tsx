import { useEffect, useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import type { DesktopUpdateState } from '@/lib/runtime'
import { ui, uit } from '@/i18n/ui'
import { Button } from '@/components/ui/button'

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
  const updateLabel = uit`Update to v${ready.version}`
  return (
    <Button
      size="sm"
      aria-label={restarting ? ui("Restarting…") : updateLabel}
      title={uit`Restart to install Pulpo v${ready.version}`}
      className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
      disabled={restarting}
      onClick={() => {
        const restartAndInstall = window.pulpoDesktop?.updates.restartAndInstall
        if (!restartAndInstall) return
        setRestarting(true)
        void restartAndInstall().catch(() => setRestarting(false))
      }}
    >
      {restarting
        ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        : <ArrowDown aria-hidden="true" className="size-3.5" />}
      {restarting ? ui("Restarting…") : ui("Update")}
    </Button>
  )
}
