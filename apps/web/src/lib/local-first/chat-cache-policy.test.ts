import { describe, expect, it } from 'vitest'
import { retainedChatQueryHashes, utf8ByteLength } from './chat-cache-policy'

describe('persisted chat query byte limits', () => {
  it('measures UTF-8 instead of JavaScript code units', () => {
    expect(utf8ByteLength('a🐙é')).toBe(7)
  })

  it('keeps recent detail queries within count and aggregate byte ceilings', () => {
    const retained = retainedChatQueryHashes([
      { queryHash: 'new-large', dataUpdatedAt: 3, data: '12345678' },
      { queryHash: 'middle', dataUpdatedAt: 2, data: '12' },
      { queryHash: 'old', dataUpdatedAt: 1, data: '1' },
    ], 2, 9)

    expect([...retained]).toEqual(['middle', 'old'])
  })
})
