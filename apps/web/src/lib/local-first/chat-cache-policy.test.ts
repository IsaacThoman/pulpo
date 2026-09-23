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

it('retains a connected recent window instead of dropping an oversized chat', async () => {
  const { fitChatToBytes } = await import('./chat-cache-policy')
  const responses = Array.from({ length: 100 }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null, output: 'x'.repeat(1000) }))
  const fitted = fitChatToBytes({ responses, activeBranchLeafId: '99', history: { offset: 0, hasMore: false, before: '0', leafId: '99' } }, 10000)!
  const retained = fitted.data as { responses: typeof responses; history: { offset: number; hasMore: boolean; before: string } }
  expect(retained.responses.length).toBeGreaterThan(1)
  expect(retained.responses.at(-1)!.id).toBe('99')
  expect(retained.history.hasMore).toBe(true)
  expect(retained.history.before).toBe(retained.responses[0]!.id)
  expect(retained.history.offset).toBe(100 - retained.responses.length)
  expect(new TextEncoder().encode(JSON.stringify(fitted.data)).byteLength).toBeLessThanOrEqual(10000)
})

it('counts only active ancestors when trimming a legacy cache with inactive siblings', async () => {
  const { fitChatToBytes } = await import('./chat-cache-policy')
  const active = Array.from({ length: 20 }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null, output: 'x'.repeat(1000) }))
  const inactive = Array.from({ length: 20 }, (_, i) => ({ id: `branch-${i}`, parentResponseId: '0', output: 'x'.repeat(1000) }))
  const fitted = fitChatToBytes({ responses: [...active, ...inactive], activeBranchLeafId: '19' }, 6000)!
  const retained = fitted.data as { responses: typeof active; history: { offset: number } }
  expect(retained.history.offset).toBe(20 - retained.responses.length)
  expect(retained.responses.at(-1)!.id).toBe('19')
})

it('does not reserialize unchanged responses when only the last response changes', async () => {
  const { fitChatToBytes } = await import('./chat-cache-policy')
  const oldBody = vi.fn(() => 'old response')
  const latestBody = vi.fn(() => 'streamed response')
  const older = { id: 'a', parentResponseId: null, output: { toJSON: oldBody } }
  fitChatToBytes({ responses: [older], activeBranchLeafId: 'a' }, 10000)
  fitChatToBytes({ responses: [older, { id: 'b', parentResponseId: 'a', output: { toJSON: latestBody } }], activeBranchLeafId: 'b' }, 10000)
  expect(oldBody).toHaveBeenCalledTimes(1)
  expect(latestBody).toHaveBeenCalledTimes(1)
})
