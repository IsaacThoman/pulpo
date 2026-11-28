import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseEvent, ResponseSnapshot } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  saved: null as Date | null,
  returning: vi.fn(),
  set: vi.fn(),
  publish: vi.fn(),
  events: [] as string[],
  xrevrange: vi.fn(),
}))
vi.mock('../database/client.js', () => ({ db: { update: () => ({ set: mocks.set }) } }))
vi.mock('../redis.js', () => ({ redis: {
  publish: mocks.publish,
  xrevrange: mocks.xrevrange,
  pipeline: () => ({
    xadd: vi.fn(), expire: vi.fn(),
    publish: (_channel: string, value: string) => mocks.events.push(value), exec: vi.fn(),
  }),
} }))
vi.mock('../config.js', () => ({ getConfig: () => ({ RESPONSE_EVENT_RETENTION_SECONDS: 3600 }) }))
const { createResponseEventPublisher, publishSnapshot, readResponseEvents } = await import('./events.js')
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 6, 0, 0, seconds))
const event = (type: string, payload: unknown, seconds: number): ResponseEvent => ({
  responseId: 'response-1', sequence: seconds, type, payload, emittedAt: at(seconds).toISOString(),
})

const newestFirst = <T>(entries: T[]) => [...entries].reverse()

describe('response event replay', () => {
  const entry = (sequence: number, fields?: string[]) => [`${sequence}-0`, fields ?? [
    'sequence', String(sequence), 'event', JSON.stringify(event('response.output_text.delta', { delta: 'text' }, sequence)),
  ]]

  it('returns only newer events in stream order and does not decode acknowledged payloads', async () => {
    mocks.xrevrange.mockResolvedValue(newestFirst([
      entry(1, ['event', 'invalid old JSON', 'sequence', '1']),
      // The acknowledged sequence itself is also skipped before decoding.
      entry(2, ['sequence', '2', 'event', 'invalid acknowledged JSON']),
      entry(3), entry(4),
    ]))
    const result = await readResponseEvents('response-1', 2)
    expect(result.map((value) => value.sequence)).toEqual([3, 4])
    expect(mocks.xrevrange).toHaveBeenCalledWith('pulpo:response:response-1:events', '+', '-', 'COUNT', 10_000)
  })

  it('keeps the newest events when the stream is longer than the replay window', async () => {
    // Approximate trimming can leave more than COUNT entries; only the newest window comes back.
    mocks.xrevrange.mockResolvedValue(newestFirst([entry(9_998), entry(9_999), entry(10_000), entry(10_001)]))
    const result = await readResponseEvents('response-1', 9_999)
    expect(result.map((value) => value.sequence)).toEqual([10_000, 10_001])
  })

  it('falls back to payload sequences for missing, noncanonical and unsafe stored sequences', async () => {
    const serialized = JSON.stringify(event('test', {}, 3))
    mocks.xrevrange.mockResolvedValue(newestFirst([
      entry(1, ['event', serialized]),
      ...['', '-1', '1.5', '01', 'NaN', '9007199254740992'].map((value) => entry(1, ['sequence', value, 'event', serialized])),
      entry(2, ['sequence', '4', 'event', JSON.stringify(event('test', {}, 1))]),
    ]))
    expect(await readResponseEvents('response-1', 2)).toHaveLength(7)
  })

  it('retains JSON errors for relevant entries and legacy entries without a valid sequence', async () => {
    mocks.xrevrange.mockResolvedValue(newestFirst([entry(3, ['sequence', '3', 'event', 'invalid JSON'])]))
    await expect(readResponseEvents('response-1', 2)).rejects.toBeInstanceOf(SyntaxError)
    mocks.xrevrange.mockResolvedValue(newestFirst([entry(1, ['event', 'invalid JSON'])]))
    await expect(readResponseEvents('response-1', 2)).rejects.toBeInstanceOf(SyntaxError)
  })

  it('handles empty streams and absent or null event payloads', async () => {
    mocks.xrevrange.mockResolvedValue(newestFirst([]))
    expect(await readResponseEvents('response-1', 0)).toEqual([])
    mocks.xrevrange.mockResolvedValue(newestFirst([entry(1, ['sequence', '1']), entry(2, ['event', 'null'])]))
    expect(await readResponseEvents('response-1', 0)).toEqual([])
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.events = []
  mocks.saved = null
  mocks.returning.mockImplementation(() => [{ firstReplyTextAt: mocks.saved ?? at(10) }])
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) })
})

describe('server reply timing publication', () => {
  it('the shared publisher persists once and carries timing on subsequent tokens', async () => {
    const publish = createResponseEventPublisher({ id: 'response-1', requestReceivedAt: at(0) })
    await publish(event('response.reasoning_summary_text.delta', { delta: 'Thinking' }, 3))
    await publish(event('pulpo.agent.tool.started', { tool: 'shell' }, 6))
    expect(mocks.set).not.toHaveBeenCalled()
    await publish(event('response.output_text.delta', { delta: 'Hello' }, 10))
    await publish(event('response.output_text.delta', { delta: ' world' }, 15))
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mocks.events.at(-1)!)).toMatchObject({ requestReceivedAt: at(0).toISOString(), firstReplyTextAt: at(10).toISOString() })
  })

  it('preserves timestamps after worker recovery or provider fallback', async () => {
    const publish = createResponseEventPublisher({ id: 'response-1', requestReceivedAt: at(0), firstReplyTextAt: at(10) })
    await publish(event('response.output_text.delta', { delta: 'More' }, 25))
    expect(mocks.set).not.toHaveBeenCalled()
    expect(JSON.parse(mocks.events[0]!)).toMatchObject({ firstReplyTextAt: at(10).toISOString() })
  })

  it('records final-output-only events before publishing', async () => {
    const publish = createResponseEventPublisher({ id: 'response-1', requestReceivedAt: at(0) })
    await publish(event('response.completed', { response: { output: [{ type: 'message', content: 'Hello' }] } }, 10))
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mocks.events[0]!)).toMatchObject({ firstReplyTextAt: at(10).toISOString() })
  })

  it('records snapshot-only reply text and leaves legacy snapshots untouched', async () => {
    const snapshot: ResponseSnapshot = {
      responseId: 'response-1', sequence: 1, status: 'completed', output: [{ type: 'message', content: 'Hello' }],
      usage: null, error: null, requestReceivedAt: at(0).toISOString(), updatedAt: at(15).toISOString(),
    }
    await publishSnapshot(snapshot)
    expect(JSON.parse(mocks.publish.mock.calls[0]![1])).toMatchObject({ firstReplyTextAt: at(10).toISOString() })
    await publishSnapshot({ ...snapshot, requestReceivedAt: null })
    expect(mocks.set).toHaveBeenCalledTimes(1)
  })
})
