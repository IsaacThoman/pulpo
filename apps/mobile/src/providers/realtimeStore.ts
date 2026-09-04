import {
  applyResponseEventToSnapshot,
  mergeResponseSnapshots,
  type ClientToServerEvents,
  type ResponseEvent,
  type ResponseSnapshot,
  type ServerToClientEvents,
} from '@pulpo/contracts'
import type { Socket } from 'socket.io-client'
import { create } from 'zustand'
import type { RealtimeConnectionPhase } from './realtimeConnection'

interface RealtimeState {
  connected: boolean
  connectionPhase: RealtimeConnectionPhase
  syncError: string | null
  snapshots: Record<string, ResponseSnapshot>
  setConnectionPhase: (connectionPhase: RealtimeConnectionPhase) => void
  setSyncError: (message: string | null) => void
  receiveEvent: (event: ResponseEvent) => void
  receiveEvents: (events: ResponseEvent[]) => void
  receiveSnapshot: (snapshot: ResponseSnapshot) => void
  removeSnapshot: (responseId: string) => void
  resetSnapshots: () => void
}

export type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type ResponseSubscription = { count: number; afterSequence: number }

let activeSocket: PulpoSocket | null = null
const chatSubscriptions = new Map<string, number>()
const responseSubscriptions = new Map<string, ResponseSubscription>()

export const useRealtimeStore = create<RealtimeState>((set) => {
  const applyEvents = (state: RealtimeState, events: ResponseEvent[]) => {
    const firstApplicableEvent = events.findIndex((event) => {
      const current = state.snapshots[event.responseId]
      return current && event.sequence > current.sequence
    })
    if (firstApplicableEvent === -1) return state

    const snapshots = { ...state.snapshots }
    for (const event of events.slice(firstApplicableEvent)) {
      const current = snapshots[event.responseId]
      if (!current || event.sequence <= current.sequence) continue
      snapshots[event.responseId] = applyResponseEventToSnapshot(current, event)
    }
    return { snapshots }
  }
  return {
    connected: false,
    connectionPhase: 'idle',
    syncError: null,
    snapshots: {},
    setConnectionPhase: (connectionPhase) => set({
      connectionPhase,
      connected: connectionPhase === 'connected',
    }),
    setSyncError: (syncError) => set({ syncError }),
    receiveEvent: (event) => set((state) => applyEvents(state, [event])),
    receiveEvents: (events) => set((state) => applyEvents(state, events)),
    receiveSnapshot: (snapshot) => set((state) => {
      const current = state.snapshots[snapshot.responseId]
      const merged = current ? mergeResponseSnapshots(current, snapshot) : snapshot
      if (merged === current) return state
      return { snapshots: { ...state.snapshots, [snapshot.responseId]: merged } }
    }),
    removeSnapshot: (responseId) => set((state) => {
      if (!state.snapshots[responseId]) return state
      const snapshots = { ...state.snapshots }
      delete snapshots[responseId]
      return { snapshots }
    }),
    resetSnapshots: () => set({ snapshots: {} }),
  }
})

export function registerRealtimeSocket(socket: PulpoSocket): () => void {
  activeSocket = socket
  return () => {
    if (activeSocket === socket) activeSocket = null
  }
}

export function activeChatSubscription(): string | undefined {
  return chatSubscriptions.keys().next().value
}

export function chatSubscriptionIds(): IterableIterator<string> {
  return chatSubscriptions.keys()
}

export function responseSubscriptionEntries(): IterableIterator<[string, ResponseSubscription]> {
  return responseSubscriptions.entries()
}

export function subscribeToChat(chatId: string): () => void {
  const count = chatSubscriptions.get(chatId) ?? 0
  chatSubscriptions.set(chatId, count + 1)
  if (count === 0 && activeSocket?.connected) activeSocket.emit('chat.subscribe', { chatId })
  let active = true
  return () => {
    if (!active) return
    active = false
    const next = (chatSubscriptions.get(chatId) ?? 1) - 1
    if (next > 0) chatSubscriptions.set(chatId, next)
    else {
      chatSubscriptions.delete(chatId)
      if (activeSocket?.connected) activeSocket.emit('chat.unsubscribe', { chatId })
    }
  }
}

export function subscribeToResponse(responseId: string, afterSequence: number): () => void {
  const current = responseSubscriptions.get(responseId)
  responseSubscriptions.set(responseId, {
    count: (current?.count ?? 0) + 1,
    afterSequence: Math.max(current?.afterSequence ?? 0, afterSequence),
  })
  if (!current && activeSocket?.connected) activeSocket.emit('response.subscribe', { responseId, afterSequence })
  let active = true
  return () => {
    if (!active) return
    active = false
    const subscription = responseSubscriptions.get(responseId)
    if (!subscription || subscription.count <= 1) {
      responseSubscriptions.delete(responseId)
      if (activeSocket?.connected) activeSocket.emit('response.unsubscribe', { responseId })
    } else {
      responseSubscriptions.set(responseId, { ...subscription, count: subscription.count - 1 })
    }
  }
}
