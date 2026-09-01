import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  ComposerDraftChange,
  ComposerDraftsCleared,
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
import { coalesceResponseEvents, groupResponseEvents, isTerminalSnapshot, stateInvalidationQueryKeys, syncInvalidationScopes, takeContiguousResponseEvents } from './response-sync'
import { isDesktopRuntime, runtimeInstanceUrl, runtimeSessionToken } from '@/lib/runtime'
import { adminAccessRequiredChatId } from '@/features/admin-chat/route-access'
import {
  applyWebComposerDraftChange,
  applyWebComposerDraftsCleared,
  flushDirtyWebComposerDrafts,
  resumeWebComposerDraftSyncEnable,
} from '@/lib/local-first/composer-drafts'
import { useSettings } from '@/stores/settings'

type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>

function invalidateStateScope(scope: StateInvalidationScope, userId: string): void {
  for (const queryKey of stateInvalidationQueryKeys(scope, userId)) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

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
    queryFn: () => apiRequest<{ data: ServerChat[] }>('/api/chats').then((response) => response.data),
    enabled: Boolean(!adminChatView && networkReady && userId && userRole !== 'pending'),
  })
  const foldersQuery = useQuery({
    queryKey: ['folders', userId],
    queryFn: () => apiRequest<{ data: ServerFolder[] }>('/api/folders').then((response) => response.data),
    enabled: Boolean(!adminChatView && networkReady && userId && userRole !== 'pending'),
  })
  const chatQuery = useQuery({
    queryKey: ['chat', userId, chatId],
    queryFn: async () => {
      const incoming = await apiRequest<ServerChat>(`/api/chats/${chatId}?format=compact&scope=active`)
      return mergeServerChatDetails(queryClient.getQueryData<ServerChat>(['chat', userId, chatId]), incoming)
    },
    enabled: Boolean(!adminChatView && networkReady && userId && chatId),
    retry: false,
    refetchOnWindowFocus: false,
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
      auth: isDesktopRuntime() ? { sessionToken: runtimeSessionToken() } : undefined,
    })
    socketRef.current = socket
    const subscribedResponseIds = subscribedResponseIdsRef.current

    let eventFrame: number | undefined
    let cursorTimer: number | undefined
    let revisionTimer: number | undefined
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
    const flushRevisionInvalidations = () => {
      if (revisionTimer !== undefined) window.clearTimeout(revisionTimer)
      revisionTimer = undefined
      const batch = pendingRevision
      pendingRevision = undefined
      if (!batch) return
      if (batch.chatIds.length || batch.accountOnlyRevisions.length) {
        void queryClient.invalidateQueries({ queryKey: ['chats', userId] })
        void queryClient.invalidateQueries({ queryKey: ['deleted-chats', userId] })
      }
      for (const changedChatId of batch.chatIds) {
        void queryClient.invalidateQueries({ queryKey: ['chat', userId, changedChatId] })
      }
      for (const scope of batch.scopes) invalidateStateScope(scope, userId)
      if (batch.accountOnlyRevisions.length) {
        void queryClient.invalidateQueries({ queryKey: ['settings', userId] })
      }
    }
    const queueRevisionInvalidation = (event: {
      revision: number
      chatId?: string
      scopes?: StateInvalidationScope[]
    }) => {
      revisionRef.current = Math.max(revisionRef.current, event.revision)
      pendingRevision = mergeRevisionInvalidation(pendingRevision, event)
      revisionTimer ??= window.setTimeout(flushRevisionInvalidations, 16)
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
      for (const scope of scopes) invalidateStateScope(scope, userId)
      if (scopes.includes('chats')) {
        void queryClient.invalidateQueries({ queryKey: ['deleted-chats', userId] })
      }
      if (scopes.includes('chats') && activeChatIdRef.current) {
        void queryClient.invalidateQueries({ queryKey: ['chat', userId, activeChatIdRef.current] })
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
    const sync = async () => {
      if (useSettings.getState().syncDrafts) await flushDirtyWebComposerDrafts(userId)
      const cursors = await localDb.responseCursors.where('tabId').equals(currentTabId).toArray()
      socket.emit('client.sync', {
        tabId: currentTabId,
        accountRevision: revisionRef.current,
        activeChatId: activeChatIdRef.current,
        responseCursors: Object.fromEntries(cursors.map((cursor) => [cursor.responseId, cursor.sequence])),
      }, applySync)
      if (activeChatIdRef.current) socket.emit('chat.subscribe', { chatId: activeChatIdRef.current })
      subscribedResponseIds.clear()
      for (const responseId of useChat.getState().streamingIds) {
        const cursor = await localDb.responseCursors.get(`${currentTabId}:${responseId}`)
        socket.emit('response.subscribe', { responseId, afterSequence: cursor?.sequence ?? 0 })
        subscribedResponseIds.add(responseId)
      }
      void flushOutbox(userId).then(async () => {
        if (useSettings.getState().syncDrafts) await resumeWebComposerDraftSyncEnable(userId)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['chats', userId] }),
          queryClient.invalidateQueries({ queryKey: ['folders', userId] }),
          queryClient.invalidateQueries({ queryKey: ['settings', userId] }),
        ])
      })
    }

    socket.on('connect', sync)
    socket.on('response.event', queueEvent)
    socket.on('response.snapshot', applyLiveSnapshot)
    socket.on('chat.changed', ({ chatId: changedChatId, revision }) => {
      queueRevisionInvalidation({ revision, chatId: changedChatId })
    })
    socket.on('account.revision', ({ revision, scopes }) => {
      queueRevisionInvalidation({ revision, scopes })
    })
    socket.on('composer.draft.changed', (event: ComposerDraftChange) => {
      revisionRef.current = Math.max(revisionRef.current, event.revision)
      void applyWebComposerDraftChange(userId, event)
    })
    socket.on('composer.drafts.cleared', (event: ComposerDraftsCleared) => {
      revisionRef.current = Math.max(revisionRef.current, event.revision)
      void applyWebComposerDraftsCleared(userId, event)
    })
    const wake = () => { if (document.visibilityState === 'visible') void sync() }
    const online = () => void sync()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', online)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', online)
      if (eventFrame !== undefined) window.clearTimeout(eventFrame)
      if (revisionTimer !== undefined) window.clearTimeout(revisionTimer)
      flushEventBatches()
      void flushCursors()
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
