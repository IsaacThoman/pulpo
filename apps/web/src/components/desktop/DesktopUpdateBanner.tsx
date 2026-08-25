import { useEffect, useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
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
  const updateLabel = uit`Update to v${ready.version}`
  return (
    <button
      type="button"
      aria-label={restarting ? ui("Restarting…") : updateLabel}
      title={uit`Restart to install Pulpo v${ready.version}`}
      className="desktop-connection-status group fixed left-[82px] top-[19px] z-50 flex h-7 min-w-7 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full bg-primary/15 px-2 text-[11px] font-medium text-primary shadow-sm ring-1 ring-inset ring-primary/15 transition-colors hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
      disabled={restarting}
      onClick={() => {
        const restartAndInstall = window.pulpoDesktop?.updates.restartAndInstall
        if (!restartAndInstall) return
        setRestarting(true)
        void restartAndInstall().catch(() => setRestarting(false))
      }}
    >
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,margin,opacity] duration-200 group-hover:mr-1.5 group-hover:max-w-20 group-hover:opacity-100 group-focus-visible:mr-1.5 group-focus-visible:max-w-20 group-focus-visible:opacity-100">
        {restarting ? ui("Restarting…") : ui("Update")}
      </span>
      {restarting
        ? <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
        : <ArrowDown aria-hidden="true" className="size-3.5 shrink-0" />}
    </button>
  )
}
