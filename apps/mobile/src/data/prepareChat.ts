import type { QueryClient } from '@tanstack/react-query'
import { chatQuery, queryKeys } from './queries'
import { protectTranscript } from './transcriptResidency'

/** Start loading without an animation gate; retain ownership until navigation settles. */
export function prepareChatSelection(client: QueryClient, namespace: string, id: string, localChatLimit: number) {
  const key = queryKeys.chat(namespace, id)
  const release = protectTranscript(namespace, id)
  const existing = client.getQueryCache().find({ queryKey: key, exact: true })
  // Never pause or cancel a request already serving another consumer.
  if (existing?.state.fetchStatus === 'fetching' || existing?.getObserversCount()) {
    return { finish: release, cancel: release }
  }

  let settled = false
  void client.prefetchQuery({ ...chatQuery(namespace, id, localChatLimit), retry: false })
  const owned = client.getQueryCache().find({ queryKey: key, exact: true })
  const ownedPromise = owned?.promise
  const settle = (cancel: boolean) => {
    if (settled) return
    settled = true
    const current = client.getQueryCache().find({ queryKey: key, exact: true })
    // A newly attached preview/detail observer adopts the request on interruption.
    const ownsFetch = current === owned && current?.promise === ownedPromise
    const adopted = ownsFetch && Boolean(current?.getObserversCount())
    if (cancel && !adopted && ownsFetch) void client.cancelQueries({ queryKey: key, exact: true }, { revert: false })
    release()
  }
  return { finish: () => settle(false), cancel: () => settle(true) }
}
