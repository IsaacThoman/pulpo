import { describe, expect, it } from 'vitest'
import type { ResponseEvent, ResponseSnapshot } from '@pulpo/contracts'
import { applyEventToSnapshot } from './response-snapshot'

const snapshot: ResponseSnapshot = {
  responseId: '00000000-0000-4000-8000-000000000001',
  status: 'queued', sequence: 0, output: [], usage: null, error: null,
  updatedAt: '2026-07-31T00:00:00.000Z',
}

function event(type: string, delta: string, sequence: number): ResponseEvent {
  return {
    responseId: snapshot.responseId, type, sequence, payload: { delta },
    emittedAt: `2026-07-31T00:00:0${sequence}.000Z`,
  }
}

describe('persisted response snapshots', () => {
  it('accumulates output text and advances the response', () => {
    const first = applyEventToSnapshot(snapshot, event('response.output_text.delta', 'Hello', 1))
    const second = applyEventToSnapshot(first, event('response.output_text.delta', ' world', 2))
    expect(second.status).toBe('in_progress')
    expect(second.sequence).toBe(2)
    expect(second.output).toMatchObject([{ content: [{ text: 'Hello world' }] }])
  })

  it('stores reasoning separately from assistant output', () => {
    const result = applyEventToSnapshot(snapshot, event('response.reasoning_summary_text.delta', 'Considering', 1))
    expect(result.output).toMatchObject([{ type: 'reasoning', summary: [{ text: 'Considering' }] }])
  })
})
