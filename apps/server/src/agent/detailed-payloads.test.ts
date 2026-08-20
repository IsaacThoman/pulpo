import { describe, expect, it } from 'vitest'
import { orderedAgentTurnPayloads } from './detailed-payloads.js'

describe('Agent detailed payloads', () => {
  it('retains every model turn in execution order', () => {
    expect(orderedAgentTurnPayloads(new Map([
      [2, { model: 'fallback', input: 'second' }],
      [1, { model: 'primary', input: 'first' }],
    ]))).toEqual({ turns: [
      { turnNumber: 1, payload: { model: 'primary', input: 'first' } },
      { turnNumber: 2, payload: { model: 'fallback', input: 'second' } },
    ] })
  })
})
