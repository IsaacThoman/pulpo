export type RealtimeConnectionPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting'

export const REALTIME_UNAVAILABLE_MESSAGE = 'Realtime is temporarily unavailable. Retrying…'
export const INITIAL_CONNECTION_FAILURE_DELAY_MS = 10_000

export function phaseAfterDisconnect(hasConnected: boolean, appIsActive: boolean): RealtimeConnectionPhase {
  if (!appIsActive) return 'idle'
  return hasConnected ? 'reconnecting' : 'connecting'
}

export function shouldShowConnectionBanner(input: {
  phase: RealtimeConnectionPhase
  offline: boolean
  syncError: string | null
}): boolean {
  return input.offline || input.phase === 'reconnecting' || Boolean(input.syncError)
}
