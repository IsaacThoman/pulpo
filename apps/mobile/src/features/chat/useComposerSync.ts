import { useEffect, useLayoutEffect, useRef } from 'react'
import { composerPatch, sameComposerContent } from '@pulpo/client-core'
import type { ComposerState } from '@pulpo/contracts'
import { usePreferencesStore } from '../../store/preferences'
import { mobileComposerSync } from './composerSync'

export function useComposerSync(userId: string | null, draftId: string, state: ComposerState, hydrated: boolean, paused: boolean, apply: (state: ComposerState) => void, editing = false) {
  const enabled = usePreferencesStore((state) => state.composerSyncEnabled)
  const identity = `${userId ?? "local"}\u0000${draftId}`
  const latest = useRef({ state, apply, paused, editing, identity })
  latest.current = { state, apply, paused, editing, identity }
  const deferred = useRef<ComposerState | null>(null)
  const wasEditing = useRef(false)
  const baseline = useRef(state)
  const skippingEdit = useRef(false)
  const hiddenSubmission = useRef<ComposerState | null>(null)
  const opened = useRef<string | null>(null)
  const sync = enabled && userId ? mobileComposerSync(userId) : null
  useEffect(() => {
    if (!sync || !hydrated) return
    let disposed = false
    let close: (() => void) | undefined
    baseline.current = latest.current.state
    deferred.current = null
    wasEditing.current = false
    skippingEdit.current = false
    hiddenSubmission.current = null
    void sync.open(draftId, latest.current.state, (checkpoint) => {
      if (disposed || !usePreferencesStore.getState().composerSyncEnabled || latest.current.identity !== identity) return
      opened.current = identity
      let remote = { ...checkpoint.snapshot.state, ...checkpoint.pending }
      // An optimistic clear is local until acceptance. Coordinator notifications
      // (including our own control writes) can still carry the submitted text.
      if (hiddenSubmission.current) {
        if (sameComposerContent(remote, hiddenSubmission.current)) remote = { ...remote, content: '', attachments: [] }
        else hiddenSubmission.current = null
      }
      // Keep the actual shared state as the baseline. Mobile can resolve model
      // defaults while applying it; those resolved values must also be synced
      // so conditional submission clears compare against the state we send.
      baseline.current = remote
      const display = remote.model ? remote : { ...remote, model: latest.current.state.model }
      if (latest.current.editing) deferred.current = display
      if (Object.keys(composerPatch(latest.current.state, display)).length) {
        latest.current.apply(display)
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
      latest.current.apply(remote)
      return
    }
    if (paused) return
    if (skippingEdit.current) { skippingEdit.current = false; baseline.current = state; return }
    const patch = composerPatch(baseline.current, state)
    if (!sameComposerContent(baseline.current, state)) hiddenSubmission.current = null
    baseline.current = state
    sync.edit(draftId, patch)
  })
  return { sync, skipNextEdit: () => { hiddenSubmission.current = latest.current.state; skippingEdit.current = true } }
}
