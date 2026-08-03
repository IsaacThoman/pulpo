import { describe, expect, it } from 'vitest'
import type { ResponseEvent, ResponseSnapshot, SyncResult } from '@pulpo/contracts'
import { coalesceResponseEvents, groupResponseEvents, isTerminalSnapshot, syncInvalidationScopes, takeContiguousResponseEvents } from './response-sync'

function snapshot(status: ResponseSnapshot['status'], responseId: string): ResponseSnapshot {
  return {
    responseId,
    status,
    sequence: 1,
    output: [],
    usage: null,
    error: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function syncResult(snapshots: ResponseSnapshot[], invalidate: SyncResult['invalidate'] = []): SyncResult {
  return { accountRevision: 1, invalidate, snapshots, events: [] }
}

describe('response sync planning', () => {
  it('recognizes only completed response states as terminal', () => {
    expect(isTerminalSnapshot(snapshot('queued', 'queued'))).toBe(false)
    expect(isTerminalSnapshot(snapshot('in_progress', 'running'))).toBe(false)
    expect(isTerminalSnapshot(snapshot('completed', 'completed'))).toBe(true)
    expect(isTerminalSnapshot(snapshot('failed', 'failed'))).toBe(true)
    expect(isTerminalSnapshot(snapshot('cancelled', 'cancelled'))).toBe(true)
  })

  it('collapses any number of terminal snapshots into one chats invalidation', () => {
    const snapshots = Array.from({ length: 141 }, (_, index) => snapshot('completed', `response-${index}`))
    expect(syncInvalidationScopes(syncResult(snapshots))).toEqual(['chats'])
  })

  it('deduplicates chats when the account revision already requested it', () => {
    expect(syncInvalidationScopes(syncResult([snapshot('completed', 'response')], ['chats', 'models'])))
      .toEqual(['chats', 'models'])
  })

  it('groups interleaved events by response without changing their order', () => {
    const events = [event('a', 1, 'A'), event('b', 1, 'B'), event('a', 2, ' C')]
    expect(groupResponseEvents(events).map((batch) => batch.map((item) => item.sequence)))
      .toEqual([[1, 2], [1]])
  })

  it('coalesces adjacent display deltas and retains the newest sequence', () => {
    const events = [event('a', 1, 'Hello'), event('a', 2, ' world')]
    expect(coalesceResponseEvents(events)).toEqual([event('a', 2, 'Hello world')])
  })

  it('does not coalesce across event boundaries', () => {
    const events = [
      event('a', 1, 'Hello'),
      { ...event('a', 2, ''), type: 'response.content_part.added' },
      event('a', 3, ' world'),
    ]
    expect(coalesceResponseEvents(events)).toHaveLength(3)
  })

  it('sorts events but waits for sequence gaps before applying incremental deltas', () => {
    const result = takeContiguousResponseEvents([
      event('a', 4, ' fourth'),
      event('a', 2, ' second'),
      event('a', 3, ' third'),
    ], 1)
    expect(result.ready.map((item) => item.sequence)).toEqual([2, 3, 4])

    const gap = takeContiguousResponseEvents([event('a', 4, ' fourth')], 2)
    expect(gap.ready).toEqual([])
    expect(gap.pending.map((item) => item.sequence)).toEqual([4])
  })

  it('never coalesces deltas for different output items', () => {
    const first = { ...event('a', 1, 'A'), payload: { delta: 'A', item_id: 'turn-1' } }
    const second = { ...event('a', 2, 'B'), payload: { delta: 'B', item_id: 'turn-2' } }
    expect(coalesceResponseEvents([first, second])).toEqual([first, second])
  })
})

function event(responseId: string, sequence: number, delta: string): ResponseEvent {
  return {
    responseId,
    sequence,
    type: 'response.output_text.delta',
    payload: { delta },
    emittedAt: `2026-08-01T00:00:0${sequence}.000Z`,
  }
}
