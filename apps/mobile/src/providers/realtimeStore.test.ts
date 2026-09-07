import { beforeEach, expect, it, vi } from 'vitest'
import type { ResponseSnapshot } from '@pulpo/contracts'
import { useRealtimeStore } from './realtimeStore'
const snapshot = (responseId: string, sequence = 1): ResponseSnapshot => ({ responseId, sequence, status: 'in_progress', output: [{ type: 'message', content: [] }], usage: null, error: null, updatedAt: '2026-09-06' })
beforeEach(() => useRealtimeStore.getState().resetSnapshots())
it('publishes one collection update and nothing for unchanged or older batches', () => {
  const listener = vi.fn()
  const unsubscribe = useRealtimeStore.subscribe(listener)
  const batch = Array.from({ length: 1000 }, (_, id) => snapshot(String(id)))
  useRealtimeStore.getState().receiveSnapshots(batch)
  expect(listener).toHaveBeenCalledOnce()
  const stable = useRealtimeStore.getState().snapshots
  useRealtimeStore.getState().receiveSnapshots(batch)
  useRealtimeStore.getState().receiveSnapshots([snapshot('0', 0)])
  expect(listener).toHaveBeenCalledOnce()
  expect(useRealtimeStore.getState().snapshots).toBe(stable)
  unsubscribe()
})
it('merges duplicate IDs in sequence order without losing terminal content or timing', () => {
  useRealtimeStore.getState().receiveSnapshots([
    { ...snapshot('a', 3), requestReceivedAt: 'received' },
    snapshot('a', 1),
    { ...snapshot('a', 3), status: 'completed', output: [] },
    snapshot('a', 3),
  ])
  expect(useRealtimeStore.getState().snapshots.a).toMatchObject({ sequence: 3, status: 'completed', requestReceivedAt: 'received', output: [{ type: 'message', content: [] }] })
})
it('removes a batch once without altering retained snapshot identities', () => {
  useRealtimeStore.getState().receiveSnapshots([snapshot('a'), snapshot('b')])
  const retained = useRealtimeStore.getState().snapshots.b
  const listener = vi.fn()
  const unsubscribe = useRealtimeStore.subscribe(listener)
  useRealtimeStore.getState().removeSnapshots(['a', 'missing'])
  expect(listener).toHaveBeenCalledOnce()
  expect(useRealtimeStore.getState().snapshots.b).toBe(retained)
  unsubscribe()
})
