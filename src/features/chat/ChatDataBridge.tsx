import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import type { ResponseEvent, ServerToClientEvents, ClientToServerEvents, SyncResult } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { localDb } from '@/lib/local-first/database'
import { warmAttachmentCache } from '@/lib/local-first/attachment-cache'
import { flushOutbox } from '@/lib/local-first/outbox'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { useChat, type ServerChat, type ServerFolder } from '@/stores/chat'
import { useCatalog } from '@/stores/catalog'
import { useSettings } from '@/stores/settings'
import { coalesceResponseEvents, groupResponseEvents, isTerminalSnapshot, syncInvalidationScopes, takeContiguousResponseEvents } from './response-sync'

type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type CompletionToast = { responseId: string; chatId: string; preview: string }

function tabId(): string {
  const existing = sessionStorage.getItem('pulpo-tab-id')
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem('pulpo-tab-id', created)
  return created
}

export function ChatDataBridge() {
  const user = useAuth((state) => state.user)
  const userId = user?.id
  const userRole = user?.role
  const location = useLocation()
  const navigate = useNavigate()
  const [completionToasts, setCompletionToasts] = useState<CompletionToast[]>([])
  const chatId = /^\/c\/([^/]+)/.exec(location.pathname)?.[1]
  const streamingIds = useChat((state) => state.streamingIds)
  const replaceSummaries = useChat((state) => state.replaceSummaries)
  const replaceFolders = useChat((state) => state.replaceFolders)
  const setDetailedChat = useChat((state) => state.setDetailedChat)
  const applyResponseEvents = useChat((state) => state.applyResponseEvents)
  const applyResponseSnapshot = useChat((state) => state.applyResponseSnapshot)
  const socketRef = useRef<PulpoSocket | null>(null)
  const subscribedResponseIdsRef = useRef(new Set<string>())
  const loadCatalog = useCatalog((state) => state.load)
  const attachmentCacheMb = useSettings((state) => state.localAttachmentCacheMb)
  const revisionRef = useRef(user?.stateRevision ?? 0)
  const currentTabId = useMemo(tabId, [])
  const activeChatIdRef = useRef(chatId)
  activeChatIdRef.current = chatId

  const chatsQuery = useQuery({
    queryKey: ['chats', userId],
    queryFn: () => apiRequest<{ data: ServerChat[] }>('/api/chats').then((response) => response.data),
    enabled: Boolean(userId && userRole !== 'pending'),
  })
  const foldersQuery = useQuery({
    queryKey: ['folders', userId],
    queryFn: () => apiRequest<{ data: ServerFolder[] }>('/api/folders').then((response) => response.data),
    enabled: Boolean(userId && userRole !== 'pending'),
  })
  const chatQuery = useQuery({
    queryKey: ['chat', userId, chatId],
    queryFn: () => apiRequest<ServerChat>(`/api/chats/${chatId}`),
    enabled: Boolean(userId && chatId),
    retry: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => { if (chatsQuery.data) replaceSummaries(chatsQuery.data) }, [chatsQuery.data, replaceSummaries])
  useEffect(() => { if (foldersQuery.data) replaceFolders(foldersQuery.data) }, [foldersQuery.data, replaceFolders])
  useEffect(() => { if (chatQuery.data) setDetailedChat(chatQuery.data) }, [chatQuery.data, setDetailedChat])
  useEffect(() => {
    if (userId && chatQuery.data?.attachments?.length) {
      void warmAttachmentCache(userId, chatQuery.data.attachments, attachmentCacheMb)
    }
  }, [userId, chatQuery.data, attachmentCacheMb])
  useEffect(() => { if (userId) void loadCatalog() }, [userId, loadCatalog])

  useEffect(() => {
    if (!userId || userRole === 'pending') return
    const socket: PulpoSocket = io({ path: '/socket.io', withCredentials: true })
    socketRef.current = socket

    let eventFrame: number | undefined
    let cursorTimer: number | undefined
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
      pendingCursors.set(responseId, Math.max(pendingCursors.get(responseId) ?? 0, sequence))
      if (cursorTimer === undefined) {
        cursorTimer = window.setTimeout(() => { void flushCursors() }, 250)
      }
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
        eventFrame = window.requestAnimationFrame(() => flushEventBatches())
      }
    }
    const applySync = (result: SyncResult) => {
      revisionRef.current = result.accountRevision
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
      for (const scope of scopes) void queryClient.invalidateQueries({ queryKey: [scope, userId] })
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
      const cursors = await localDb.responseCursors.where('tabId').equals(currentTabId).toArray()
      socket.emit('client.sync', {
        tabId: currentTabId,
        accountRevision: revisionRef.current,
        activeChatId: activeChatIdRef.current,
        responseCursors: Object.fromEntries(cursors.map((cursor) => [cursor.responseId, cursor.sequence])),
      }, applySync)
      if (activeChatIdRef.current) socket.emit('chat.subscribe', { chatId: activeChatIdRef.current })
      subscribedResponseIdsRef.current.clear()
      for (const responseId of useChat.getState().streamingIds) {
        const cursor = await localDb.responseCursors.get(`${currentTabId}:${responseId}`)
        socket.emit('response.subscribe', { responseId, afterSequence: cursor?.sequence ?? 0 })
        subscribedResponseIdsRef.current.add(responseId)
      }
      void flushOutbox(userId).then(() => queryClient.invalidateQueries({ queryKey: ['chats', userId] }))
    }

    socket.on('connect', sync)
    socket.on('response.event', queueEvent)
    socket.on('response.snapshot', applyLiveSnapshot)
    socket.on('response.completed', (completion) => {
      if (!useSettings.getState().notifications) return
      if (completion.chatId === activeChatIdRef.current && document.visibilityState === 'visible') return
      setCompletionToasts((current) => current.some((toast) => toast.responseId === completion.responseId)
        ? current
        : [...current, completion].slice(-3))
      window.setTimeout(() => {
        setCompletionToasts((current) => current.filter((toast) => toast.responseId !== completion.responseId))
      }, 8_000)
    })
    socket.on('chat.changed', ({ chatId: changedChatId }) => {
      void queryClient.invalidateQueries({ queryKey: ['chats', userId] })
      void queryClient.invalidateQueries({ queryKey: ['deleted-chats', userId] })
      void queryClient.invalidateQueries({ queryKey: ['chat', userId, changedChatId] })
    })
    socket.on('account.revision', ({ revision }) => {
      revisionRef.current = revision
      void queryClient.invalidateQueries({ queryKey: ['chats', userId] })
      void queryClient.invalidateQueries({ queryKey: ['deleted-chats', userId] })
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
      if (eventFrame !== undefined) window.cancelAnimationFrame(eventFrame)
      flushEventBatches()
      void flushCursors()
      socket.disconnect()
      socketRef.current = null
      subscribedResponseIdsRef.current.clear()
    }
  }, [userId, userRole, currentTabId, applyResponseEvents, applyResponseSnapshot])

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

  if (!completionToasts.length) return null
  return <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
    {completionToasts.map((toast) => <div key={toast.responseId} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
      <button className="min-w-0 flex-1 text-left" onClick={() => {
        setCompletionToasts((current) => current.filter((item) => item.responseId !== toast.responseId))
        navigate(`/c/${toast.chatId}`)
      }}>
        <span className="block text-sm font-medium">Response complete</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{toast.preview || 'Open the chat to view the response.'}</span>
      </button>
      <button className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Dismiss notification" onClick={() => setCompletionToasts((current) => current.filter((item) => item.responseId !== toast.responseId))}>
        <X className="size-3.5" />
      </button>
    </div>)}
  </div>
}
