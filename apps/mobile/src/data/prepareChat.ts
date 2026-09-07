import type { QueryClient } from '@tanstack/react-query'
import { chatQuery, queryKeys } from './queries'
import { protectTranscript } from './transcriptResidency'

/** Start native I/O now, but keep decoding and publishing off the animation path. */
export function prepareChatSelection(client: QueryClient, namespace: string, id: string, localChatLimit: number) {
  const key = queryKeys.chat(namespace, id)
  const release = protectTranscript(namespace, id)
  const existing = client.getQueryCache().find({ queryKey: key, exact: true })
  // Never pause or cancel a request already serving another consumer.
  if (existing?.state.fetchStatus === 'fetching' || existing?.getObserversCount()) {
    return { localReady: Promise.resolve(Boolean((existing.state.data as { responses?: unknown } | undefined)?.responses)), allowLocal() {}, pauseLocal() {}, finish: release, cancel: release }
  }

  let phase: 'waiting' | 'ready' | 'cancelled' = 'waiting'
  let localAllowed = false
  let resolveLocal!: (available: boolean) => void
  const localReady = new Promise<boolean>((resolve) => { resolveLocal = resolve })
  if ((existing?.state.data as { responses?: unknown } | undefined)?.responses) resolveLocal(true)
  const waiters = new Set<() => void>()
  const wait = (signal: AbortSignal, source: 'local' | 'network') => new Promise<void>((resolve, reject) => {
    const check = () => {
      if (phase === 'waiting' && !(source === 'local' && localAllowed) && !signal.aborted) return
      waiters.delete(check)
      signal.removeEventListener('abort', check)
      if (phase === 'cancelled' || signal.aborted) reject(new Error('Chat preparation cancelled'))
      else resolve()
    }
    waiters.add(check)
    signal.addEventListener('abort', check, { once: true })
    check()
  })
  void client.prefetchQuery({ ...chatQuery(namespace, id, localChatLimit, { beforeDecode: wait, onLocalReady: resolveLocal }), retry: false })
  const owned = client.getQueryCache().find({ queryKey: key, exact: true })
  const ownedPromise = owned?.promise
  const settle = (cancel: boolean) => {
    if (phase !== 'waiting') return
    const current = client.getQueryCache().find({ queryKey: key, exact: true })
    // A newly attached preview/detail observer adopts the request on interruption.
    const ownsFetch = current === owned && current?.promise === ownedPromise
    const adopted = ownsFetch && Boolean(current?.getObserversCount())
    phase = cancel && !adopted ? 'cancelled' : 'ready'
    if (cancel && !adopted && ownsFetch) void client.cancelQueries({ queryKey: key, exact: true }, { revert: false })
    for (const check of waiters) check()
    resolveLocal(false)
    release()
  }
  return {
    localReady,
    allowLocal() { localAllowed = true; for (const check of waiters) check() },
    pauseLocal() { localAllowed = false },
    finish: () => settle(false), cancel: () => settle(true),
  }
}
