import { describe, expect, it } from 'vitest'
import type { ResponseSnapshot, SyncResult } from '@pulpo/contracts'
import { isTerminalSnapshot, syncInvalidationScopes } from './response-sync'

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
})
