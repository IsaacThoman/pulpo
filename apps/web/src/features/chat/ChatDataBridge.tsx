import { useComposerSyncPreference } from '@/stores/composer-sync-preference'
import { bindWebComposerSocket } from '@/lib/local-first/composer-sync'
import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  ResponseEvent,
  ServerToClientEvents,
  StateInvalidationScope,
  SyncResult,
} from '@pulpo/contracts'
import { mergeRevisionInvalidation, type RevisionInvalidationBatch } from '@pulpo/client-core'
import { apiRequest, ApiError } from '@/lib/api'
import { localDb } from '@/lib/local-first/database'
import { flushOutbox } from '@/lib/local-first/outbox'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { mergeServerChatDetails, useChat, type ServerChat, type ServerFolder } from '@/stores/chat'
import { useCatalog } from '@/stores/catalog'
import { coalesceResponseEvents, groupResponseEvents, outboxInvalidationQueryKeys, isTerminalSnapshot, stateInvalidationQueryKeys, syncInvalidationScopes, takeContiguousResponseEvents } from './response-sync'
import { isDesktopRuntime, runtimeInstanceUrl, runtimeSessionToken } from '@/lib/runtime'
import { createSyncScheduler } from './sync-scheduler'
import { adminAccessRequiredChatId } from '@/features/admin-chat/route-access'

type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>

function tabId(): string {
  const existing = sessionStorage.getItem('pulpo-tab-id')
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem('pulpo-tab-id', created)
  return created
}

export function ChatDataBridge() {
  const user = useAuth((state) => state.user)
  const instanceReady = useAuth((state) => state.instanceReady)
  const userId = user?.id
  const userRole = user?.role
  const location = useLocation()
  const adminChatView = location.pathname.startsWith('/admin/chats/')
  const routeChatId = /^\/c\/([^/]+)/.exec(location.pathname)?.[1]
  const activeTemporaryChatId = useChat((state) => state.activeTemporaryChatId)
  const chatId = routeChatId ?? activeTemporaryChatId ?? undefined
  const streamingIds = useChat((state) => state.streamingIds)
  const replaceSummaries = useChat((state) => state.replaceSummaries)
  const replaceFolders = useChat((state) => state.replaceFolders)
  const setDetailedChat = useChat((state) => state.setDetailedChat)
  const setAdminAccessRequiredChat = useChat((state) => state.setAdminAccessRequiredChat)
  const applyResponseEvents = useChat((state) => state.applyResponseEvents)
  const applyResponseSnapshot = useChat((state) => state.applyResponseSnapshot)
  const socketRef = useRef<PulpoSocket | null>(null)
  const subscribedResponseIdsRef = useRef(new Set<string>())
  const loadCatalog = useCatalog((state) => state.load)
  const revisionRef = useRef(user?.stateRevision ?? 0)
  const currentTabId = useMemo(tabId, [])
  const networkReady = !isDesktopRuntime() || instanceReady
  const activeChatIdRef = useRef(chatId)
  activeChatIdRef.current = chatId

  const chatsQuery = useQuery({
    queryKey: ['chats', userId],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => apiRequest<{ data: ServerChat[] }>('/api/chats', { signal }).then((response) => response.data),
    enabled: Boolean(!adminChatView && networkReady && userId && userRole !== 'pending'),
  })
  const foldersQuery = useQuery({
    queryKey: ['folders', userId],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => apiRequest<{ data: ServerFolder[] }>('/api/folders', { signal }).then((response) => response.data),
    enabled: Boolean(!adminChatView && networkReady && userId && userRole !== 'pending'),
  })
  const chatQuery = useQuery({
    queryKey: ['chat', userId, chatId],
    queryFn: async ({ signal }) => {
      const incoming = await apiRequest<ServerChat>(`/api/chats/${chatId}?format=compact&scope=active`, { signal })
      return mergeServerChatDetails(queryClient.getQueryData<ServerChat>(['chat', userId, chatId]), incoming)
    },
    enabled: Boolean(!adminChatView && networkReady && userId && chatId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => { if (chatsQuery.data) replaceSummaries(chatsQuery.data) }, [chatsQuery.data, replaceSummaries])
  useEffect(() => { if (foldersQuery.data) replaceFolders(foldersQuery.data) }, [foldersQuery.data, replaceFolders])
  useEffect(() => { if (chatQuery.data) setDetailedChat(chatQuery.data) }, [chatQuery.data, setDetailedChat])
  useEffect(() => {
    setAdminAccessRequiredChat(adminAccessRequiredChatId(chatId, chatQuery.error))
  }, [chatId, chatQuery.error, setAdminAccessRequiredChat])
  useEffect(() => {
    if (chatId === activeTemporaryChatId && chatQuery.error instanceof ApiError && chatQuery.error.code === 'temporary_chat_expired') {
      useChat.getState().markTemporaryExpired(chatId)
    }
  }, [activeTemporaryChatId, chatId, chatQuery.error])
  useEffect(() => { if (networkReady && userId) void loadCatalog() }, [networkReady, userId, loadCatalog])

  useEffect(() => {
    if (adminChatView || !networkReady || !userId || userRole === 'pending') return
    const socket: PulpoSocket = io(isDesktopRuntime() ? runtimeInstanceUrl() : undefined, {
      path: '/socket.io',
      withCredentials: !isDesktopRuntime(),
      auth: { composerSyncEnabled: useComposerSyncPreference.getState().enabled, ...(isDesktopRuntime() ? { sessionToken: runtimeSessionToken() } : {}) },
    })
    const unbindComposer = bindWebComposerSocket(userId, socket)
    socketRef.current = socket
    const subscribedResponseIds = subscribedResponseIdsRef.current

    let eventFrame: number | undefined
    let cursorTimer: number | undefined
    let revisionTimer: number | undefined
    let disposed = false
    const pendingQueryKeys = new Map<string, string[]>()
    let pendingRevision: RevisionInvalidationBatch | undefined
    const pendingEvents = new Map<string, ResponseEvent[]>()
    const pendingCursors = new Map<string, number>()

    const flushCursors = async () => {
      if (cursorTimer !== undefined) window.clearTimeout(cursorTimer)
      cursorTimer = undefined
      if (pendingCursors.size === 0) return
      const updatedAt = Date.now()
      const rows = [...pendingCursors].map(([responseId, sequence]) => ({
        id: `${currentTabId}:${responseId}`, tabId: currentTabId, responseId, sequence, updatedAt,
      }))
      pendingCursors.clear()
      await localDb.responseCursors.bulkPut(rows)
    }
    const rememberCursor = (responseId: string, sequence: number) => {
      const state = useChat.getState()
      const responseChatId = state.responseChatIds[responseId]
      if (responseChatId && state.chats.some((chat) => chat.id === responseChatId && chat.temporary)) {
        pendingCursors.delete(responseId)
        void localDb.responseCursors.delete(`${currentTabId}:${responseId}`)
        return
      }
      pendingCursors.set(responseId, Math.max(pendingCursors.get(responseId) ?? 0, sequence))
      if (cursorTimer === undefined) {
        cursorTimer = window.setTimeout(() => { void flushCursors() }, 250)
      }
    }
    const flushInvalidations = () => {
      revisionTimer = undefined
      const batch = pendingRevision
      pendingRevision = undefined
      const add = (key: string[]) => pendingQueryKeys.set(JSON.stringify(key), key)
      if (batch) {
        if (batch.chatIds.length || batch.accountOnlyRevisions.length || batch.scopes.includes('chats')) {
          add(['chats', userId])
          add(['deleted-chats', userId])
        }
        for (const id of batch.chatIds) add(['chat', userId, id])
        for (const scope of batch.scopes) for (const key of stateInvalidationQueryKeys(scope, userId)) add(key)
        if (batch.accountOnlyRevisions.length) add(['settings', userId])
      }
      for (const queryKey of pendingQueryKeys.values()) void queryClient.invalidateQueries({ queryKey })
      pendingQueryKeys.clear()
    }
    const queueInvalidation = (queryKey: string[]) => {
      pendingQueryKeys.set(JSON.stringify(queryKey), queryKey)
      revisionTimer ??= window.setTimeout(flushInvalidations, 16)
    }
    const invalidateStateScope = (scope: StateInvalidationScope) => {
      for (const key of stateInvalidationQueryKeys(scope, userId)) queueInvalidation(key)
    }
    const queueRevisionInvalidation = (event: {
      revision: number
      chatId?: string
      scopes?: StateInvalidationScope[]
    }) => {
      revisionRef.current = Math.max(revisionRef.current, event.revision)
      pendingRevision = mergeRevisionInvalidation(pendingRevision, event)
      revisionTimer ??= window.setTimeout(flushInvalidations, 16)
    }
    const applyEventBatch = (events: ResponseEvent[]) => {
      const compacted = coalesceResponseEvents(events)
      if (!applyResponseEvents(compacted)) return
      const latest = compacted.reduce((current, event) =>
        !current || event.sequence > current.sequence ? event : current, undefined as ResponseEvent | undefined)
      if (latest) rememberCursor(latest.responseId, latest.sequence)
    }
    const flushEventBatches = (responseId?: string) => {
      if (!responseId) eventFrame = undefined
      const responseIds = responseId ? [responseId] : [...pendingEvents.keys()]
      for (const id of responseIds) {
        const events = pendingEvents.get(id)
        if (!events) continue
        const currentSequence = useChat.getState().responseSequences[id] ?? 0
        const { ready, pending } = takeContiguousResponseEvents(events, currentSequence)
        if (pending.length) pendingEvents.set(id, pending)
        else pendingEvents.delete(id)
        if (ready.length) applyEventBatch(ready)
      }
    }
    const queueEvent = (event: ResponseEvent) => {
      const events = pendingEvents.get(event.responseId)
      if (events) events.push(event)
      else pendingEvents.set(event.responseId, [event])
      if (eventFrame === undefined) {
        eventFrame = window.setTimeout(() => flushEventBatches(), 50)
      }
    }
    const applySync = (result: SyncResult) => {
      revisionRef.current = Math.max(revisionRef.current, result.accountRevision)
      for (const events of groupResponseEvents(result.events)) {
        for (const event of events) queueEvent(event)
        flushEventBatches(events[0]?.responseId)
      }
      for (const snapshot of result.snapshots) {
        applyResponseSnapshot(snapshot, { invalidate: false })
        flushEventBatches(snapshot.responseId)
        if (isTerminalSnapshot(snapshot)) {
          pendingCursors.delete(snapshot.responseId)
          void flushCursors().finally(() => localDb.responseCursors.delete(`${currentTabId}:${snapshot.responseId}`))
        } else {
          rememberCursor(snapshot.responseId, snapshot.sequence)
        }
      }
      const scopes = syncInvalidationScopes(result)
      for (const scope of scopes) invalidateStateScope(scope)
      if (scopes.includes('chats')) {
        queueInvalidation(['deleted-chats', userId])
      }
      if (scopes.includes('chats') && activeChatIdRef.current) {
        queueInvalidation(['chat', userId, activeChatIdRef.current])
      }
    }
    const applyLiveSnapshot = (snapshot: Parameters<typeof applyResponseSnapshot>[0]) => {
      flushEventBatches(snapshot.responseId)
      applyResponseSnapshot(snapshot)
      flushEventBatches(snapshot.responseId)
      if (isTerminalSnapshot(snapshot)) {
        pendingCursors.delete(snapshot.responseId)
        void flushCursors().finally(() => localDb.responseCursors.delete(`${currentTabId}:${snapshot.responseId}`))
      } else {
        rememberCursor(snapshot.responseId, snapshot.sequence)
      }
    }
    const syncScheduler = createSyncScheduler(async () => {
      if (disposed || !socket.connected) return
      const settledPaths = await flushOutbox(userId)
      if (disposed) return
      for (const key of outboxInvalidationQueryKeys(settledPaths, userId, activeChatIdRef.current)) queueInvalidation(key)
      const cursors = await localDb.responseCursors.where('tabId').equals(currentTabId).toArray()
      if (disposed || !socket.connected) return
      const afterSequences = new Map(cursors.map((cursor) => [cursor.responseId, cursor.sequence]))
      const result = await socket.timeout(10_000).emitWithAck('client.sync', {
        tabId: currentTabId,
        accountRevision: revisionRef.current,
        activeChatId: activeChatIdRef.current,
        responseCursors: Object.fromEntries(afterSequences),
      })
      if (disposed || !socket.connected) return
      applySync(result)
      if (activeChatIdRef.current) socket.emit('chat.subscribe', { chatId: activeChatIdRef.current })
      subscribedResponseIds.clear()
      for (const responseId of useChat.getState().streamingIds) {
        socket.emit('response.subscribe', { responseId, afterSequence: afterSequences.get(responseId) ?? 0 })
        subscribedResponseIds.add(responseId)
      }
    }, (error) => {
      if (!disposed && socket.connected) console.warn('Unable to synchronize chat state', error)
    })

    socket.on('connect', syncScheduler.request)
    socket.on('response.event', queueEvent)
    socket.on('response.snapshot', applyLiveSnapshot)
    socket.on('chat.changed', ({ chatId: changedChatId, revision }) => {
      queueRevisionInvalidation({ revision, chatId: changedChatId })
    })
    socket.on('account.revision', ({ revision, scopes }) => {
      queueRevisionInvalidation({ revision, scopes })
    })
    const wake = () => { if (document.visibilityState === 'visible') syncScheduler.request() }
    const online = syncScheduler.request
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', online)
    return () => {
      disposed = true
      syncScheduler.dispose()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', online)
      if (eventFrame !== undefined) window.clearTimeout(eventFrame)
      if (revisionTimer !== undefined) window.clearTimeout(revisionTimer)
      flushEventBatches()
      void flushCursors()
      unbindComposer()
      socket.disconnect()
      socketRef.current = null
      subscribedResponseIds.clear()
    }
  }, [adminChatView, networkReady, userId, userRole, currentTabId, applyResponseEvents, applyResponseSnapshot])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return
    let cancelled = false
    const next = new Set(streamingIds)
    for (const responseId of subscribedResponseIdsRef.current) {
      if (next.has(responseId)) continue
      socket.emit('response.unsubscribe', { responseId })
      subscribedResponseIdsRef.current.delete(responseId)
    }
    for (const responseId of streamingIds) {
      if (subscribedResponseIdsRef.current.has(responseId)) continue
      void localDb.responseCursors.get(`${currentTabId}:${responseId}`).then((cursor) => {
        if (cancelled) return
        socket.emit('response.subscribe', { responseId, afterSequence: cursor?.sequence ?? 0 })
        subscribedResponseIdsRef.current.add(responseId)
      })
    }
    return () => { cancelled = true }
  }, [streamingIds, currentTabId])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !chatId) return
    socket.emit('chat.subscribe', { chatId })
    return () => { socket.emit('chat.unsubscribe', { chatId }) }
  }, [chatId])

  return null
}
