import { describe, expect, it } from 'vitest'
import { responseEventSchema, syncRequestSchema } from './index.js'

describe('shared contracts', () => {
  it('rejects response events without a positive sequence', () => {
    const result = responseEventSchema.safeParse({
      responseId: crypto.randomUUID(),
      sequence: 0,
      type: 'response.created',
      payload: {},
      emittedAt: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('accepts per-response synchronization cursors', () => {
    const responseId = crypto.randomUUID()
    const result = syncRequestSchema.parse({
      tabId: 'tab-1',
      accountRevision: 3,
      responseCursors: { [responseId]: 42 },
    })
    expect(result.responseCursors[responseId]).toBe(42)
  })
})
