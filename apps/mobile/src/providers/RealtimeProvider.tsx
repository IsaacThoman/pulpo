import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import { applyResponseEventToSnapshot, type ResponseEvent, type ResponseSnapshot, type ServerToClientEvents, type ClientToServerEvents } from '@pulpo/contracts'
import { create } from 'zustand'
import { apiOrigin } from '../api/client'
import { cacheNamespace, responseCursors, saveResponseCursor } from '../data/database'
import { replayOutbox } from '../data/outbox'
import { queryKeys } from '../data/queries'
import { useSessionStore } from '../store/session'

interface RealtimeState {
  connected: boolean
  syncError: string | null
  snapshots: Record<string, ResponseSnapshot>
  setConnected: (connected: boolean) => void
  setSyncError: (message: string | null) => void
  receiveEvent: (event: ResponseEvent) => void
  receiveSnapshot: (snapshot: ResponseSnapshot) => void
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  connected: false,
  syncError: null,
  snapshots: {},
  setConnected: (connected) => set({ connected }),
  setSyncError: (syncError) => set({ syncError }),
  receiveEvent: (event) => set((state) => {
    const current = state.snapshots[event.responseId]
    if (!current || event.sequence <= current.sequence) return state
    return { snapshots: { ...state.snapshots, [event.responseId]: applyResponseEventToSnapshot(current, event) } }
  }),
  receiveSnapshot: (snapshot) => set((state) => {
    const current = state.snapshots[snapshot.responseId]
    if (current && current.sequence > snapshot.sequence) return state
    return { snapshots: { ...state.snapshots, [snapshot.responseId]: snapshot } }
  }),
}))

let activeSocket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null

export function subscribeToChat(chatId: string): () => void {
  activeSocket?.emit('chat.subscribe', { chatId })
  return () => activeSocket?.emit('chat.unsubscribe', { chatId })
}

export function subscribeToResponse(responseId: string, afterSequence: number): () => void {
  activeSocket?.emit('response.subscribe', { responseId, afterSequence })
  return () => activeSocket?.emit('response.unsubscribe', { responseId })
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const token = useSessionStore((state) => state.token)
  const userId = useSessionStore((state) => state.user?.id)
  const userStateRevision = useSessionStore((state) => state.user?.stateRevision ?? 0)
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const queryClient = useQueryClient()
  const stateRevision = useRef(userStateRevision)
  const namespace = userId ? cacheNamespace(instanceUrl, userId) : null

  useEffect(() => {
    stateRevision.current = Math.max(stateRevision.current, userStateRevision)
  }, [userStateRevision])

  useEffect(() => {
    if (!token || !userId || !namespace) return
    const socket = io(apiOrigin(), {
      path: '/socket.io', transports: ['websocket'], auth: { sessionToken: token }, reconnection: true,
    }) as Socket<ServerToClientEvents, ClientToServerEvents>
    activeSocket = socket
    socket.on('connect', () => {
      useRealtimeStore.getState().setConnected(true)
      void replayOutbox(namespace).then(({ rejected }) => {
        useRealtimeStore.getState().setSyncError(rejected
          ? `${rejected} offline change${rejected === 1 ? '' : 's'} could not be synced and was reconciled with the server.`
          : null)
        if (rejected) void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
      })
      void responseCursors(namespace).then((cursors) => socket.emit('client.sync', {
        tabId: `ios-${userId}`,
        accountRevision: stateRevision.current,
        responseCursors: cursors,
      }, (result) => {
        stateRevision.current = result.accountRevision
        for (const snapshot of result.snapshots) useRealtimeStore.getState().receiveSnapshot(snapshot)
        for (const event of result.events) useRealtimeStore.getState().receiveEvent(event)
        if (result.invalidate.includes('chats')) void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
      }))
    })
    socket.on('disconnect', () => useRealtimeStore.getState().setConnected(false))
    socket.on('response.event', (event) => {
      useRealtimeStore.getState().receiveEvent(event)
      void saveResponseCursor(namespace, event.responseId, event.sequence)
    })
    socket.on('response.snapshot', (snapshot) => {
      useRealtimeStore.getState().receiveSnapshot(snapshot)
      void saveResponseCursor(namespace, snapshot.responseId, snapshot.sequence)
      if (!['queued', 'in_progress'].includes(snapshot.status)) void queryClient.invalidateQueries({ queryKey: ['chat', namespace] })
    })
    socket.on('response.completed', ({ chatId }) => void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) }))
    socket.on('chat.changed', ({ chatId, revision }) => {
      stateRevision.current = revision
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
    })
    socket.on('account.revision', ({ revision }) => { stateRevision.current = revision })
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !socket.connected) socket.connect()
    })
    return () => {
      appState.remove()
      socket.disconnect()
      if (activeSocket === socket) activeSocket = null
      useRealtimeStore.getState().setConnected(false)
    }
  }, [instanceUrl, namespace, queryClient, token, userId])

  return children
}
