import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { composerPatch } from '@pulpo/client-core'
import type { ComposerState } from '@pulpo/contracts'
import { mobileComposerSync } from './composerSync'

export function useComposerSync(userId: string | null, draftId: string, state: ComposerState, hydrated: boolean, paused: boolean, apply: (state: ComposerState) => void, editing = false) {
  const [recoverable, setRecoverable] = useState(false)
  const identity = `${userId ?? "local"}\u0000${draftId}`
  const latest = useRef({ state, apply, paused, editing, identity })
  latest.current = { state, apply, paused, editing, identity }
  const deferred = useRef<ComposerState | null>(null)
  const wasEditing = useRef(false)
  const baseline = useRef(state)
  const applying = useRef(false)
  const opened = useRef<string | null>(null)
  const sync = userId ? mobileComposerSync(userId) : null
  useEffect(() => {
    if (!sync || !hydrated) return
    let disposed = false
    let close: (() => void) | undefined
    baseline.current = latest.current.state
    deferred.current = null
    wasEditing.current = false
    applying.current = false
    void sync.open(draftId, latest.current.state, (checkpoint) => {
      if (disposed || latest.current.identity !== identity) return
      opened.current = identity
      setRecoverable(Boolean(checkpoint.recovery))
      const remote = { ...checkpoint.snapshot.state, ...checkpoint.pending }
      if (!remote.model) remote.model = latest.current.state.model
      if (latest.current.editing) deferred.current = remote
      if (Object.keys(composerPatch(latest.current.state, remote)).length) {
        applying.current = true
        baseline.current = remote
        latest.current.apply(remote)
      }
    }).then((cleanup) => { if (disposed) cleanup(); else close = cleanup })
    return () => { disposed = true; opened.current = null; close?.() }
  }, [sync, draftId, hydrated, identity])
  useLayoutEffect(() => {
    if (!hydrated || opened.current !== identity || !sync) return
    if (editing && !wasEditing.current) deferred.current ??= baseline.current
    wasEditing.current = editing
    if (!editing && deferred.current) {
      const remote = deferred.current
      deferred.current = null
      applying.current = true
      latest.current.apply(remote)
      return
    }
    if (paused) return
    if (applying.current) { applying.current = false; baseline.current = state; return }
    const patch = composerPatch(baseline.current, state)
    baseline.current = state
    sync.edit(draftId, patch)
  })
  return { sync, skipNextEdit: () => { applying.current = true }, recoverable, recover: () => sync?.recover(draftId) }
}
