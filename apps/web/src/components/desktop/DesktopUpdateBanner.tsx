import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@/lib/runtime'

const DISMISSED_UPDATE_KEY = 'pulpo-dismissed-update'

function visibleReadyState(state: DesktopUpdateState): Extract<DesktopUpdateState, { status: 'ready' }> | null {
  if (state.status !== 'ready') return null
  return sessionStorage.getItem(DISMISSED_UPDATE_KEY) === state.version ? null : state
}

export function DesktopUpdateBanner() {
  const [ready, setReady] = useState<Extract<DesktopUpdateState, { status: 'ready' }> | null>(null)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    const updates = window.pulpoDesktop?.updates
    if (!updates) return
    let active = true
    let receivedEvent = false
    const applyState = (state: DesktopUpdateState) => {
      if (active) setReady(visibleReadyState(state))
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
    <div className="flex min-h-9 items-center justify-center gap-3 bg-primary px-4 py-2 text-center text-xs text-primary-foreground">
      <span>Pulpo v{ready.version} is ready.</span>
      <button
        className="font-semibold underline underline-offset-2 disabled:opacity-60"
        disabled={restarting}
        onClick={() => {
          const restartAndInstall = window.pulpoDesktop?.updates.restartAndInstall
          if (!restartAndInstall) return
          setRestarting(true)
          void restartAndInstall().catch(() => setRestarting(false))
        }}
      >
        {restarting ? 'Restarting…' : 'Restart to update'}
      </button>
      <button
        className="opacity-80 hover:opacity-100"
        onClick={() => {
          sessionStorage.setItem(DISMISSED_UPDATE_KEY, ready.version)
          setReady(null)
        }}
      >
        Later
      </button>
    </div>
  )
}
