import type { ClientToServerEvents, ServerToClientEvents } from '@pulpo/contracts'
import type { Socket } from 'socket.io-client'
import { create } from 'zustand'

export type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/** The account's realtime connection, owned by ChatDataBridge and shared with feature views. */
export const useRealtimeSocket = create<{ socket: PulpoSocket | null }>(() => ({ socket: null }))
