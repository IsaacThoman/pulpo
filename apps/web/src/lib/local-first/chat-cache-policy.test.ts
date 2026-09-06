import { describe, expect, it, vi } from 'vitest'
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

it('reuses byte measurements for unchanged immutable data', () => {
  const toJSON = vi.fn(() => ({ content: 'x'.repeat(100_000) }))
  const data = { toJSON }
  const query = { queryHash: 'chat', dataUpdatedAt: 1, data }
  retainedChatQueryHashes([query], 50)
  retainedChatQueryHashes([{ ...query, dataUpdatedAt: 2 }], 50)
  expect(toJSON).toHaveBeenCalledTimes(1)
  retainedChatQueryHashes([{ ...query, data: { toJSON } }], 50)
  expect(toJSON).toHaveBeenCalledTimes(2)
})
