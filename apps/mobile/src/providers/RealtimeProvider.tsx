import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import * as Crypto from 'expo-crypto'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import {
  type ResponseEvent,
  type ResponseSnapshot,
  type SyncResult,
} from '@pulpo/contracts'
import { apiOrigin } from '../api/client'
import {
  cacheNamespace,
  deleteResponseCursor,
  getValue,
  responseCursors,
  saveResponseCursors,
  setValue,
} from '../data/database'
import { replayOutbox } from '../data/outbox'
import { queryKeys } from '../data/queries'
import { useSessionStore } from '../store/session'
import {
  coalesceResponseEvents,
  groupResponseEvents,
  isTerminalSnapshot,
  REALTIME_RENDER_INTERVAL_MS,
  syncInvalidationScopes,
  takeContiguousResponseEvents,
} from './realtimeSync'
import {
  activeChatSubscription,
  chatSubscriptionIds,
  registerRealtimeSocket,
  responseSubscriptionEntries,
  useRealtimeStore,
  type PulpoSocket,
} from './realtimeStore'

async function realtimeClientId(namespace: string): Promise<string> {
  const existing = await getValue<string>(namespace, 'realtime-client-id')
  if (existing) return existing
  const created = `ios-${Crypto.randomUUID()}`
  await setValue(namespace, 'realtime-client-id', created)
  return created
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const token = useSessionStore((state) => state.token)
  const userId = useSessionStore((state) => state.user?.id)
  const userStateRevision = useSessionStore((state) => state.user?.stateRevision ?? 0)
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const queryClient = useQueryClient()
  const stateRevision = useRef(userStateRevision)
  const namespace = userId ? cacheNamespace(instanceUrl, userId) : null
  const revisionNamespace = useRef(namespace)

  useEffect(() => {
    if (revisionNamespace.current !== namespace) {
      revisionNamespace.current = namespace
      stateRevision.current = userStateRevision
      useRealtimeStore.getState().resetSnapshots()
      return
    }
    stateRevision.current = Math.max(stateRevision.current, userStateRevision)
  }, [namespace, userStateRevision])

  useEffect(() => {
    if (!token || !userId || !namespace) return
    const socket = io(apiOrigin(), {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { sessionToken: token },
      autoConnect: false,
      reconnection: true,
      reconnectionDelayMax: 5_000,
      timeout: 10_000,
    }) as PulpoSocket
    const unregisterSocket = registerRealtimeSocket(socket)

    let disposed = false
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    let cursorTimer: ReturnType<typeof setTimeout> | undefined
    let cursorWriteTail: Promise<void> = Promise.resolve()
    const pendingEvents = new Map<string, ResponseEvent[]>()
    const pendingCursors = new Map<string, number>()

    const queueCursorWrite = (write: () => Promise<void>): Promise<void> => {
      const result = cursorWriteTail.then(write)
      cursorWriteTail = result.catch(() => undefined)
      return result
    }
    const flushCursors = async () => {
      if (cursorTimer) clearTimeout(cursorTimer)
      cursorTimer = undefined
      if (pendingCursors.size === 0) return cursorWriteTail
      const cursors = Object.fromEntries(pendingCursors)
      pendingCursors.clear()
      return queueCursorWrite(() => saveResponseCursors(namespace, cursors))
    }
    const rememberCursor = (responseId: string, sequence: number) => {
      pendingCursors.set(responseId, Math.max(pendingCursors.get(responseId) ?? 0, sequence))
      cursorTimer ??= setTimeout(() => { void flushCursors().catch(() => undefined) }, 250)
    }
    const applyEventBatch = (events: ResponseEvent[]) => {
      const compacted = coalesceResponseEvents(events)
      useRealtimeStore.getState().receiveEvents(compacted)
      const responseId = compacted[0]?.responseId
      if (!responseId) return
      const sequence = useRealtimeStore.getState().snapshots[responseId]?.sequence
      if (sequence !== undefined) rememberCursor(responseId, sequence)
    }
    const flushEventBatches = (responseId?: string) => {
      if (!responseId) eventTimer = undefined
      const responseIds = responseId ? [responseId] : [...pendingEvents.keys()]
      for (const id of responseIds) {
        const events = pendingEvents.get(id)
        const current = useRealtimeStore.getState().snapshots[id]
        if (!events || !current) continue
        const { ready, pending } = takeContiguousResponseEvents(events, current.sequence)
        if (pending.length) pendingEvents.set(id, pending)
        else pendingEvents.delete(id)
        if (ready.length) applyEventBatch(ready)
      }
    }
    const queueEvent = (event: ResponseEvent) => {
      const events = pendingEvents.get(event.responseId)
      if (events) events.push(event)
      else pendingEvents.set(event.responseId, [event])
      eventTimer ??= setTimeout(() => flushEventBatches(), REALTIME_RENDER_INTERVAL_MS)
    }
    const finishCursor = (responseId: string) => {
      pendingCursors.delete(responseId)
      void flushCursors().catch(() => undefined)
        .then(() => queueCursorWrite(() => deleteResponseCursor(namespace, responseId)))
    }
    const applySnapshot = (snapshot: ResponseSnapshot) => {
      useRealtimeStore.getState().receiveSnapshot(snapshot)
      flushEventBatches(snapshot.responseId)
      const current = useRealtimeStore.getState().snapshots[snapshot.responseId]
      if (current && isTerminalSnapshot(current)) finishCursor(snapshot.responseId)
      else if (current) rememberCursor(snapshot.responseId, current.sequence)
    }
    const invalidateScope = (scope: SyncResult['invalidate'][number], activeChatId?: string) => {
      if (scope === 'chats') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.deletedChats(namespace) })
        if (activeChatId) void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, activeChatId) })
      } else if (scope === 'models') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.models(namespace) })
      }
    }
    const applySync = (result: SyncResult, activeChatId?: string) => {
      stateRevision.current = Math.max(stateRevision.current, result.accountRevision)
      for (const snapshot of result.snapshots) applySnapshot(snapshot)
      for (const events of groupResponseEvents(result.events)) {
        for (const event of events) queueEvent(event)
        flushEventBatches(events[0]?.responseId)
      }
      for (const scope of syncInvalidationScopes(result)) invalidateScope(scope, activeChatId)
    }
    const sync = async () => {
      if (!socket.connected || disposed) return
      try {
        const [tabId, cursors] = await Promise.all([realtimeClientId(namespace), responseCursors(namespace)])
        if (!socket.connected || disposed) return
        const activeChatId = activeChatSubscription()
        socket.emit('client.sync', {
          tabId,
          accountRevision: stateRevision.current,
          ...(activeChatId ? { activeChatId } : {}),
          responseCursors: cursors,
        }, (result) => { if (!disposed) applySync(result, activeChatId) })
        for (const chatId of chatSubscriptionIds()) socket.emit('chat.subscribe', { chatId })
        for (const [responseId, subscription] of responseSubscriptionEntries()) {
          socket.emit('response.subscribe', {
            responseId,
            afterSequence: Math.max(cursors[responseId] ?? 0, subscription.afterSequence),
          })
        }
        void replayOutbox(namespace).then(({ replayed, rejected }) => {
          useRealtimeStore.getState().setSyncError(rejected
            ? `${rejected} offline change${rejected === 1 ? '' : 's'} could not be synced and was reconciled with the server.`
            : null)
          if (replayed || rejected) invalidateScope('chats', activeChatId)
        }).catch((error) => {
          useRealtimeStore.getState().setSyncError(error instanceof Error ? error.message : 'Offline changes could not be synced.')
        })
      } catch (error) {
        useRealtimeStore.getState().setSyncError(error instanceof Error ? error.message : 'Realtime sync failed.')
      }
    }

    socket.on('connect', () => {
      useRealtimeStore.getState().setConnected(true)
      useRealtimeStore.getState().setSyncError(null)
      void sync()
    })
    socket.on('disconnect', () => useRealtimeStore.getState().setConnected(false))
    socket.on('connect_error', () => {
      useRealtimeStore.getState().setConnected(false)
      useRealtimeStore.getState().setSyncError('Realtime is temporarily unavailable. Retrying…')
    })
    socket.on('response.event', queueEvent)
    socket.on('response.snapshot', applySnapshot)
    socket.on('response.completed', ({ chatId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
    })
    socket.on('chat.changed', ({ chatId, revision }) => {
      stateRevision.current = Math.max(stateRevision.current, revision)
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.deletedChats(namespace) })
    })
    socket.on('account.revision', ({ revision }) => {
      stateRevision.current = Math.max(stateRevision.current, revision)
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.deletedChats(namespace) })
    })
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      if (socket.connected) void sync()
      else socket.connect()
    })
    // Attach every listener before opening the transport so a fast cold-start connection cannot be missed.
    socket.connect()
    return () => {
      disposed = true
      appState.remove()
      if (eventTimer) clearTimeout(eventTimer)
      flushEventBatches()
      void flushCursors().catch(() => undefined)
      socket.disconnect()
      unregisterSocket()
      useRealtimeStore.getState().setConnected(false)
    }
  }, [instanceUrl, namespace, queryClient, token, userId])

  return children
}
