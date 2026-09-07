import type { QueryClient } from '@tanstack/react-query'
import { cachedChatBytes } from '../data/database'
import { flushCacheWrites } from '../data/writeBehind'
import { TranscriptResidency, registerTranscriptResidency, transcriptWriteProtected } from '../data/transcriptResidency'
import { releaseChatProjector } from '../features/chat/projectorCache'
import { pendingOptimisticResponseIds } from '../mockup5/src/production/optimisticResponses'
import { usePrototypeStore } from '../mockup5/src/store/prototypeStore'
import { useRealtimeStore } from './realtimeStore'
import type { ServerChat } from '../types'

export function startTranscriptResidency(client: QueryClient, namespace: string) {
  let disposed = false
  const revisions = new Map<string, number>()
  const documents = new WeakMap<object, number>()
  const evictedResponses = new Set<string>()
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleSnapshotCleanup = () => {
    cleanupTimer ??= setTimeout(() => {
      cleanupTimer = undefined
      if (disposed || client.isFetching({ queryKey: ['chat', namespace] })) return
      const snapshots = useRealtimeStore.getState().snapshots
      useRealtimeStore.getState().removeSnapshots([...evictedResponses].filter((id) => {
        const snapshot = snapshots[id]
        return snapshot && snapshot.status !== 'queued' && snapshot.status !== 'in_progress'
      }))
    }, 0)
  }
  const key = (id: string) => ['chat', namespace, id]
  const manager = new TranscriptResidency({
    protected: (id, responseIds) => {
      const query = client.getQueryCache().find({ queryKey: key(id), exact: true })
      if (query?.isActive() || query?.state.fetchStatus === 'fetching' || transcriptWriteProtected(namespace, id)
        || pendingOptimisticResponseIds(namespace, id).length) return true
      const snapshots = useRealtimeStore.getState().snapshots
      const detail = query?.state.data as ServerChat | undefined
      const statuses = new Map(detail?.responses?.map((response) => [response.id, response.status]))
      return [...responseIds].some((id) => {
        const status = snapshots[id]?.status ?? statuses.get(id)
        return status === 'queued' || status === 'in_progress'
      }) || Boolean(detail?.queuedMessages?.some((item) => item.pendingSubmissionId && !item.localFailure))
    },
    settle: () => flushCacheWrites(namespace),
    evict: (id, responseIds) => {
      if (disposed || usePrototypeStore.getState().productionNamespace !== namespace) return
      client.removeQueries({ queryKey: key(id), exact: true })
      releaseChatProjector(id)
      usePrototypeStore.setState((state) => ({ chats: state.chats.map((chat) => chat.id === id
        ? { ...chat, messages: [], detailLoaded: false } : chat) }))
      useRealtimeStore.getState().removeSnapshots([...responseIds].filter((responseId) => {
        const snapshot = useRealtimeStore.getState().snapshots[responseId]
        return snapshot && snapshot.status !== 'queued' && snapshot.status !== 'in_progress'
      }))
      revisions.delete(id)
      for (const responseId of responseIds) evictedResponses.add(responseId)
    },
  })
  const unregister = registerTranscriptResidency(namespace, manager)
  const register = (chat: ServerChat) => {
    if (!chat.responses) return
    const responseIds = chat.responses.map((response) => response.id)
    for (const id of responseIds) evictedResponses.delete(id)
    // Conservative upper bound until native persisted-byte metadata is available.
    // Only serialize new query graphs, never on streamed snapshot updates.
    let bytes = documents.get(chat.responses)
    if (bytes === undefined) { bytes = JSON.stringify(chat).length * 3; documents.set(chat.responses, bytes) }
    manager.register(chat.id, bytes, responseIds)
    const revision = (revisions.get(chat.id) ?? 0) + 1
    revisions.set(chat.id, revision)
    void flushCacheWrites(namespace).then(() => cachedChatBytes(namespace, chat.id)).then((storedBytes) => {
      if (disposed || revisions.get(chat.id) !== revision || storedBytes === undefined) return
      manager.updateBytes(chat.id, storedBytes)
    }).catch(() => undefined)
  }
  const unsubscribeQueries = client.getQueryCache().subscribe((event) => {
    const query = event.query
    if (query.queryKey[0] !== 'chat' || query.queryKey[1] !== namespace) return
    scheduleSnapshotCleanup()
    if (event.type === 'removed') manager.expire(String(query.queryKey[2]))
    else if (event.type === 'updated' && event.action.type === 'success') register(query.state.data as ServerChat)
    else manager.schedule()
  })
  const unsubscribeSnapshots = useRealtimeStore.subscribe((state, previous) => {
    // Sweeping every token would duplicate rendering work. Completion releases protection.
    if (state.snapshots === previous.snapshots) return
    for (const [id, snapshot] of Object.entries(state.snapshots)) {
      if (snapshot.status !== previous.snapshots[id]?.status && snapshot.status !== 'queued' && snapshot.status !== 'in_progress') {
        manager.schedule(); scheduleSnapshotCleanup(); break
      }
    }
  })
  for (const query of client.getQueryCache().findAll({ queryKey: ['chat', namespace] })) {
    if (query.state.data) register(query.state.data as ServerChat)
  }
  return {
    activate: (id: string | null) => manager.activate(id),
    dispose: () => {
      disposed = true; unsubscribeQueries(); unsubscribeSnapshots(); unregister()
      if (cleanupTimer) clearTimeout(cleanupTimer)
      evictedResponses.clear()
      void client.cancelQueries({ queryKey: ['chat', namespace] })
      client.removeQueries({ queryKey: ['chat', namespace] })
    },
  }
}
