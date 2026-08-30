import { describe, expect, it } from 'vitest'
import type { ResponseEvent, ResponseSnapshot, SyncResult } from '@pulpo/contracts'
import {
  coalesceResponseEvents,
  groupResponseEvents,
  isTerminalSnapshot,
  REALTIME_RENDER_INTERVAL_MS,
  stateInvalidationQueryKeys,
  syncInvalidationScopes,
  takeContiguousResponseEvents,
} from './realtimeSync'

const responseId = '00000000-0000-4000-8000-000000000001'

function event(sequence: number, type = 'response.output_text.delta', delta = String(sequence)): ResponseEvent {
  return { responseId, sequence, type, payload: { item_id: 'message', content_index: 0, delta }, emittedAt: new Date(sequence).toISOString() }
}

function snapshot(status: ResponseSnapshot['status']): ResponseSnapshot {
  return { responseId, sequence: 4, status, output: [], usage: null, error: null, updatedAt: new Date().toISOString() }
}

describe('mobile realtime sync helpers', () => {
  it('caps native rendering updates at a sustainable cadence', () => {
    expect(REALTIME_RENDER_INTERVAL_MS).toBeGreaterThanOrEqual(80)
    expect(REALTIME_RENDER_INTERVAL_MS).toBeLessThanOrEqual(150)
  })

  it('only releases contiguous events and retains sequence gaps', () => {
    expect(takeContiguousResponseEvents([event(4), event(2), event(3), event(2)], 1)).toEqual({
      ready: [event(2), event(3), event(4)],
      pending: [],
    })
    expect(takeContiguousResponseEvents([event(4), event(2)], 1)).toEqual({
      ready: [event(2)],
      pending: [event(4)],
    })
  })

  it('coalesces compatible text deltas without losing the final sequence', () => {
    const compacted = coalesceResponseEvents([event(1, undefined, 'Hel'), event(2, undefined, 'lo')])
    expect(compacted).toHaveLength(1)
    expect(compacted[0]?.sequence).toBe(2)
    expect(compacted[0]?.payload).toMatchObject({ delta: 'Hello' })
  })

  it('does not coalesce events for different output targets', () => {
    const second = { ...event(2), payload: { ...(event(2).payload as Record<string, unknown>), item_id: 'other' } }
    expect(coalesceResponseEvents([event(1), second])).toHaveLength(2)
  })

  it('groups events by response and promotes terminal syncs to chat invalidation', () => {
    const other = { ...event(1), responseId: '00000000-0000-4000-8000-000000000003' }
    expect(groupResponseEvents([event(1), other, event(2)])).toEqual([[event(1), event(2)], [other]])
    expect(isTerminalSnapshot(snapshot('completed'))).toBe(true)
    const result = { snapshots: [snapshot('completed')], events: [], invalidate: [], accountRevision: 1 } as SyncResult
    expect(syncInvalidationScopes(result)).toContain('chats')
  })

  it('maps folder invalidations to the account folder query', () => {
    expect(stateInvalidationQueryKeys('folders', 'instance|user')).toEqual([
      ['folders', 'instance|user'],
    ])
  })

  it('maps draft invalidations without refreshing chat history', () => {
    expect(stateInvalidationQueryKeys('drafts', 'instance|user')).toEqual([
      ['drafts', 'instance|user'],
    ])
  })
})
