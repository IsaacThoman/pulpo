import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@earendil-works/pi-ai'
import { isContextFallbackExcluded } from '../agent/fallback-policy.js'
import { classifyGenerationError } from '../responses/fallback-policy.js'
import { dropOldestPiUnit } from './pi-history.js'
import {
  CompactionError,
  CompactionOverflowError,
  summarizeWithOverflowRetry,
  trimHistoryToTokenLimit,
  TRIM_YIELD_INTERVAL,
} from './summarize.js'
import { piFullEstimate } from './tokens.js'

const dropFirst = (history: number[]) => history.length > 1 ? history.slice(1) : undefined
const total = (history: number[]) => history.reduce((sum, value) => sum + value, 0)

describe('trimHistoryToTokenLimit', () => {
  it('returns the history untouched when it already fits', async () => {
    const history = [1, 2, 3]
    await expect(trimHistoryToTokenLimit({ history, tokens: total, limit: 6, dropOldest: dropFirst }))
      .resolves.toEqual({ history, dropped: 0, fits: true })
  })

  it('drops the oldest units until the history fits', async () => {
    await expect(trimHistoryToTokenLimit({ history: [5, 4, 3, 2], tokens: total, limit: 5, dropOldest: dropFirst }))
      .resolves.toEqual({ history: [3, 2], dropped: 2, fits: true })
  })

  it('returns the most-trimmed history instead of throwing when nothing more can be dropped', async () => {
    await expect(trimHistoryToTokenLimit({ history: [5, 4, 9], tokens: total, limit: 5, dropOldest: dropFirst }))
      .resolves.toEqual({ history: [9], dropped: 2, fits: false })
    // A drop that removes nothing stops instead of looping.
    await expect(trimHistoryToTokenLimit({ history: [5, 9], tokens: total, limit: 5, dropOldest: (history) => history }))
      .resolves.toEqual({ history: [5, 9], dropped: 0, fits: false })
  })

  it('yields to the event loop while dropping many units', async () => {
    let callsWhenYielded: number | undefined
    let calls = 0
    setImmediate(() => { callsWhenYielded = calls })
    const result = await trimHistoryToTokenLimit({
      history: Array.from({ length: 100 }, () => 1),
      tokens: (history) => { calls += 1; return total(history) },
      limit: 1,
      dropOldest: dropFirst,
    })
    expect(result).toMatchObject({ dropped: 99, fits: true })
    // The first yield comes after TRIM_YIELD_INTERVAL drops, well before the trim ends.
    expect(callsWhenYielded).toBe(TRIM_YIELD_INTERVAL)
  })

  it('estimates each message once while trimming a long agent history', async () => {
    // Text reads happen only in the estimator, so they count estimate work per message.
    let textReads = 0
    const text = (value: string) => {
      const part = { type: 'text' as const, text: '' }
      Object.defineProperty(part, 'text', { enumerable: true, get: () => { textReads += 1; return value } })
      return part
    }
    const history: Message[] = [{ role: 'user', content: [text('task')], timestamp: 0 }]
    for (let turn = 0; turn < 3_000; turn += 1) {
      history.push({
        role: 'assistant',
        content: [text('x'.repeat(400)), { type: 'toolCall', id: `c${turn}`, name: 'read', arguments: {} }],
        api: 'openai-responses', provider: 'openai', model: 'm', stopReason: 'toolUse', timestamp: 0,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      })
      history.push({ role: 'toolResult', toolCallId: `c${turn}`, toolName: 'read', content: [text('y'.repeat(400))], isError: false, timestamp: 0 })
    }
    expect(history).toHaveLength(6_001)
    const result = await trimHistoryToTokenLimit({
      history,
      tokens: (messages) => piFullEstimate({ systemPrompt: 'system', messages }),
      limit: 400_000,
      dropOldest: dropOldestPiUnit,
    })
    expect(result.fits).toBe(true)
    expect(result.dropped).toBeGreaterThan(1_000)
    expect(result.history[0]).toBe(history[0])
    // Re-estimating the remaining history after each drop would read millions of parts.
    expect(textReads).toBe(history.length)
  })
})

describe('summarizeWithOverflowRetry', () => {
  it('returns the trimmed summary from the first successful attempt', async () => {
    const invoke = vi.fn(async () => '  summary \n')
    await expect(summarizeWithOverflowRetry({ history: [1, 2], dropOldest: dropFirst, invoke })).resolves.toEqual({ summary: 'summary', dropped: 0 })
    expect(invoke).toHaveBeenCalledWith([1, 2])
  })

  it('drops exactly one unit per context overflow and retries', async () => {
    const attempts: number[][] = []
    const invoke = async (history: number[]) => {
      attempts.push(history)
      if (history.length > 2) throw new CompactionOverflowError()
      return 'done'
    }
    await expect(summarizeWithOverflowRetry({ history: [1, 2, 3, 4], dropOldest: dropFirst, invoke })).resolves.toEqual({ summary: 'done', dropped: 2 })
    expect(attempts).toEqual([[1, 2, 3, 4], [2, 3, 4], [3, 4]])
  })

  it('fails once nothing more can be dropped', async () => {
    const invoke = async () => { throw new CompactionOverflowError() }
    const result = summarizeWithOverflowRetry({ history: [1, 2], dropOldest: dropFirst, invoke })
    await expect(result).rejects.toThrow(CompactionError)
    await expect(result).rejects.toThrow(/compaction/i)
  })

  it('drops a lone first user message the provider rejects and summarizes without it', async () => {
    const first: Message = { role: 'user', content: 'x'.repeat(1_000), timestamp: 0 }
    const invoke = vi.fn(async (history: Message[]) => {
      if (history.length) throw new CompactionOverflowError()
      return 'summary'
    })
    await expect(summarizeWithOverflowRetry({ history: [first], dropOldest: dropOldestPiUnit, invoke })).resolves.toEqual({ summary: 'summary', dropped: 1 })
    expect(invoke.mock.calls.map(([history]) => history)).toEqual([[first], []])
  })

  it('bounds the number of drops', async () => {
    const invoke = vi.fn(async () => { throw new CompactionOverflowError() })
    await expect(summarizeWithOverflowRetry({ history: Array.from({ length: 100 }, (_, index) => index), dropOldest: dropFirst, invoke, maxDrops: 3 }))
      .rejects.toThrow(CompactionError)
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  it('propagates other errors without retrying', async () => {
    const invoke = vi.fn(async () => { throw new Error('upstream exploded') })
    await expect(summarizeWithOverflowRetry({ history: [1, 2], dropOldest: dropFirst, invoke })).rejects.toThrow('upstream exploded')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty summary', async () => {
    await expect(summarizeWithOverflowRetry({ history: [1], dropOldest: dropFirst, invoke: async () => ' \n ' }))
      .rejects.toThrow('Compaction produced an empty summary')
  })

  it('produces errors that both fallback policies treat as compaction failures', async () => {
    const empty = await summarizeWithOverflowRetry({ history: [1], dropOldest: dropFirst, invoke: async () => '' }).catch((error: Error) => error)
    const overflow = await summarizeWithOverflowRetry({
      history: [1],
      dropOldest: dropFirst,
      invoke: async () => { throw new CompactionOverflowError() },
    }).catch((error: Error) => error)
    for (const error of [empty, overflow]) {
      expect(error).toBeInstanceOf(CompactionError)
      expect(isContextFallbackExcluded((error as Error).message)).toBe(true)
      expect(classifyGenerationError(error)).toBe('worker')
    }
  })
})
