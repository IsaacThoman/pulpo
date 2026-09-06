import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseEvent, ResponseSnapshot } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  saved: null as Date | null,
  returning: vi.fn(),
  set: vi.fn(),
  publish: vi.fn(),
  events: [] as string[],
}))
vi.mock('../database/client.js', () => ({ db: { update: () => ({ set: mocks.set }) } }))
vi.mock('../redis.js', () => ({ redis: {
  publish: mocks.publish,
  pipeline: () => ({
    xadd: vi.fn(), expire: vi.fn(),
    publish: (_channel: string, value: string) => mocks.events.push(value), exec: vi.fn(),
  }),
} }))
vi.mock('../config.js', () => ({ getConfig: () => ({ RESPONSE_EVENT_RETENTION_SECONDS: 3600 }) }))
const { createResponseEventPublisher, publishSnapshot } = await import('./events.js')
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 6, 0, 0, seconds))
const event = (type: string, payload: unknown, seconds: number): ResponseEvent => ({
  responseId: 'response-1', sequence: seconds, type, payload, emittedAt: at(seconds).toISOString(),
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
