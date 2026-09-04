import { subscribeToOutboxChanges } from '../data/outboxNotifications'
import { bindMobileComposerSocket } from '../features/chat/composerSync'
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
import { mergeRevisionInvalidation, type RevisionInvalidationBatch } from '@pulpo/client-core'
import { apiOrigin } from '../api/client'
import {
  cacheNamespace,
  deleteResponseCursor,
  getValue,
  pendingOutbox,
  responseCursors,
  saveResponseCursors,
  setValue,
} from '../data/database'
import { replayOutbox } from '../data/outbox'
import { queryKeys } from '../data/queries'
import type { ServerChat } from '../types'
import { useSessionStore } from '../store/session'
import {
  coalesceResponseEvents,
  groupResponseEvents,
  isTerminalSnapshot,
  REALTIME_RENDER_INTERVAL_MS,
  stateInvalidationQueryKeys,
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
import {
  FOREGROUND_CONNECTION_GRACE_MS,
  INITIAL_CONNECTION_FAILURE_DELAY_MS,
  phaseAfterDisconnect,
  REALTIME_UNAVAILABLE_MESSAGE,
} from './realtimeConnection'

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
    const unbindComposer = bindMobileComposerSocket(namespace, socket)
    const unregisterSocket = registerRealtimeSocket(socket)

    let disposed = false
    let silentConnectionAttempt = true
    let appStateValue = AppState.currentState
    let foregroundGraceUntil = Date.now() + FOREGROUND_CONNECTION_GRACE_MS
    let connectionFailureTimer: ReturnType<typeof setTimeout> | undefined
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    let cursorTimer: ReturnType<typeof setTimeout> | undefined
    let outboxTimer: ReturnType<typeof setTimeout> | undefined
    let revisionTimer: ReturnType<typeof setTimeout> | undefined
    let pendingRevision: RevisionInvalidationBatch | undefined
    let cursorWriteTail: Promise<void> = Promise.resolve()
    const pendingEvents = new Map<string, ResponseEvent[]>()
    const pendingCursors = new Map<string, number>()

    const clearConnectionFailureTimer = () => {
      if (connectionFailureTimer) clearTimeout(connectionFailureTimer)
      connectionFailureTimer = undefined
    }
    const scheduleConnectionFailure = () => {
      if (connectionFailureTimer || appStateValue !== 'active') return
      connectionFailureTimer = setTimeout(() => {
        connectionFailureTimer = undefined
        if (!disposed && !socket.connected && appStateValue === 'active') {
          useRealtimeStore.getState().setSyncError(REALTIME_UNAVAILABLE_MESSAGE)
        }
      }, INITIAL_CONNECTION_FAILURE_DELAY_MS)
    }

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
      const activeChatId = activeChatSubscription()
      const activeChat = activeChatId
        ? queryClient.getQueryData<ServerChat>(queryKeys.chat(namespace, activeChatId))
        : undefined
      if (activeChat?.temporary && activeChat.responses?.some((response) => response.id === responseId)) {
        pendingCursors.delete(responseId)
        void queueCursorWrite(() => deleteResponseCursor(namespace, responseId))
        return
      }
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
      for (const queryKey of stateInvalidationQueryKeys(scope, namespace, activeChatId)) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }
    const flushRevisionInvalidations = () => {
      if (revisionTimer) clearTimeout(revisionTimer)
      revisionTimer = undefined
      const batch = pendingRevision
      pendingRevision = undefined
      if (!batch) return
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.deletedChats(namespace) })
      for (const chatId of batch.chatIds) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) })
      }
      for (const scope of batch.scopes) invalidateScope(scope)
      if (batch.accountOnlyRevisions.length) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings(namespace) })
      }
    }
    const queueRevisionInvalidation = (event: {
      revision: number
      chatId?: string
      scopes?: SyncResult['invalidate']
    }) => {
      stateRevision.current = Math.max(stateRevision.current, event.revision)
      pendingRevision = mergeRevisionInvalidation(pendingRevision, event)
      revisionTimer ??= setTimeout(flushRevisionInvalidations, 16)
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
    const scheduleOutboxReplay = (delay = 1_000) => {
      if (disposed || !socket.connected || appStateValue !== 'active') return
      if (outboxTimer) clearTimeout(outboxTimer)
      outboxTimer = setTimeout(() => { outboxTimer = undefined; void flushOutbox() }, delay)
    }
    const flushOutbox = async () => {
      if (disposed || !socket.connected || appStateValue !== 'active') return
      try {
        const { replayed, rejected } = await replayOutbox(namespace, queryClient)
        if (disposed) return
        if (replayed || rejected) {
          useRealtimeStore.getState().setSyncError(rejected
            ? `${rejected} offline change${rejected === 1 ? '' : 's'} could not be synced. Queued messages can be edited and retried.` : null)
          invalidateScope('chats', activeChatSubscription())
          invalidateScope('folders')
          void queryClient.invalidateQueries({ queryKey: queryKeys.settings(namespace) })
        }
        const remaining = await pendingOutbox(namespace)
        if (remaining.length) scheduleOutboxReplay(Math.max(1_000, remaining[0]!.nextAttemptAt - Date.now()))
      } catch (error) {
        if (!disposed) {
          useRealtimeStore.getState().setSyncError(error instanceof Error ? error.message : 'Offline changes could not be synced.')
          scheduleOutboxReplay(5_000)
        }
      }
    }
    const unsubscribeOutbox = subscribeToOutboxChanges((changedNamespace) => {
      if (changedNamespace === namespace) scheduleOutboxReplay()
    })
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
        }, (result) => {
          if (disposed) return
          if (appStateValue === 'active') silentConnectionAttempt = false
          applySync(result, activeChatId)
        })
        for (const chatId of chatSubscriptionIds()) socket.emit('chat.subscribe', { chatId })
        for (const [responseId, subscription] of responseSubscriptionEntries()) {
          socket.emit('response.subscribe', {
            responseId,
            afterSequence: Math.max(cursors[responseId] ?? 0, subscription.afterSequence),
          })
        }
        void flushOutbox()
      } catch (error) {
        useRealtimeStore.getState().setSyncError(error instanceof Error ? error.message : 'Realtime sync failed.')
      }
    }

    socket.on('connect', () => {
      clearConnectionFailureTimer()
      useRealtimeStore.getState().setConnectionPhase('connected')
      useRealtimeStore.getState().setSyncError(null)
      void sync()
    })
    socket.on('disconnect', () => {
      if (disposed) return
      const phase = phaseAfterDisconnect(
        !silentConnectionAttempt,
        appStateValue === 'active',
        Date.now() >= foregroundGraceUntil,
      )
      useRealtimeStore.getState().setConnectionPhase(phase)
      if (phase === 'connecting') scheduleConnectionFailure()
    })
    socket.on('connect_error', () => {
      if (disposed) return
      const phase = phaseAfterDisconnect(
        !silentConnectionAttempt,
        appStateValue === 'active',
        Date.now() >= foregroundGraceUntil,
      )
      useRealtimeStore.getState().setConnectionPhase(phase)
      scheduleConnectionFailure()
    })
    socket.on('response.event', queueEvent)
    socket.on('response.snapshot', applySnapshot)
    socket.on('response.completed', ({ chatId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
    })
    socket.on('chat.changed', ({ chatId, revision }) => {
      queueRevisionInvalidation({ chatId, revision })
    })
    socket.on('account.revision', ({ revision, scopes }) => {
      queueRevisionInvalidation({ revision, scopes })
    })
    const appState = AppState.addEventListener('change', (state) => {
      appStateValue = state
      if (state !== 'active') {
        silentConnectionAttempt = true
        clearConnectionFailureTimer()
        useRealtimeStore.getState().setConnectionPhase('idle')
        return
      }
      silentConnectionAttempt = true
      foregroundGraceUntil = Date.now() + FOREGROUND_CONNECTION_GRACE_MS
      if (socket.connected) {
        useRealtimeStore.getState().setConnectionPhase('connected')
        void sync()
      } else {
        useRealtimeStore.getState().setConnectionPhase('connecting')
        if (useRealtimeStore.getState().syncError === REALTIME_UNAVAILABLE_MESSAGE) {
          useRealtimeStore.getState().setSyncError(null)
        }
        scheduleConnectionFailure()
        socket.connect()
      }
    })
    // Attach every listener before opening the transport so a fast cold-start connection cannot be missed.
    useRealtimeStore.getState().setConnectionPhase('connecting')
    scheduleConnectionFailure()
    socket.connect()
    return () => {
      disposed = true
      appState.remove()
      unsubscribeOutbox()
      if (outboxTimer) clearTimeout(outboxTimer)
      clearConnectionFailureTimer()
      if (eventTimer) clearTimeout(eventTimer)
      if (revisionTimer) clearTimeout(revisionTimer)
      flushEventBatches()
      void flushCursors().catch(() => undefined)
      socket.disconnect()
      unbindComposer()
      unregisterSocket()
      useRealtimeStore.getState().setConnectionPhase('idle')
    }
  }, [instanceUrl, namespace, queryClient, token, userId])

  return children
}
