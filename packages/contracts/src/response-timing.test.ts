import { describe, expect, it } from 'vitest'
import { applyResponseEventToSnapshot, mergeResponseSnapshots, type ResponseEvent, type ResponseSnapshot } from './index.js'
import { eventHasAssistantReplyText, initialResponseDurationMs } from './response-timing.js'

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 6, 0, 0, seconds)).toISOString()
const base: ResponseSnapshot = {
  responseId: 'response-1', sequence: 0, status: 'queued', output: [], usage: null, error: null,
  requestReceivedAt: at(0), firstReplyTextAt: null, updatedAt: at(0),
}
const event = (sequence: number, type: string, payload: unknown, seconds = sequence): ResponseEvent => ({
  responseId: base.responseId, sequence, type, payload, emittedAt: at(seconds),
})
const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] }

describe('initial response timing', () => {
  it('includes setup and work, then freezes through completion and replay', () => {
    const reasoning = applyResponseEventToSnapshot(base, event(1, 'response.reasoning_summary_text.delta', { delta: 'Thinking' }, 3))
    expect(initialResponseDurationMs(reasoning)).toBeUndefined()
    const first = applyResponseEventToSnapshot(reasoning, event(2, 'response.output_text.delta', { delta: 'Hello' }, 10))
    const later = applyResponseEventToSnapshot(first, event(3, 'response.output_text.delta', { delta: ' world' }, 15))
    const completed = mergeResponseSnapshots(later, { ...base, status: 'completed', sequence: 4, updatedAt: at(30), output: [message] })
    expect(initialResponseDurationMs(first)).toBe(10_000)
    expect(initialResponseDurationMs(completed, at(30))).toBe(10_000)
    expect(applyResponseEventToSnapshot(completed, event(2, 'response.output_text.delta', { delta: 'Hello' }, 10))).toBe(completed)
    expect(initialResponseDurationMs(JSON.parse(JSON.stringify(completed)))).toBe(10_000)
  })

  it.each([
    ['response.reasoning_summary_text.delta', { delta: 'Thought' }],
    ['pulpo.agent.tool.started', { tool: 'shell', status: 'running' }],
    ['response.output_text.delta', { delta: '' }],
    ['response.output_text.delta', { delta: '  \n' }],
    ['response.output_item.done', { item: { type: 'reasoning', summary: [{ text: 'Thought' }] } }],
  ])('ignores %s without reply text', (type, payload) => {
    expect(eventHasAssistantReplyText(type, payload)).toBe(false)
  })

  it.each([
    ['response.output_text.delta', { delta: 'Hello' }],
    ['response.output_text.done', { text: 'Hello' }],
    ['response.output_item.done', { item: message }],
    ['response.content_part.done', { part: message.content[0] }],
    ['response.completed', { response: { output: [message] } }],
  ])('accepts reply text from %s', (type, payload) => {
    expect(eventHasAssistantReplyText(type, payload)).toBe(true)
  })

  it('uses authoritative timing carried by batched events', () => {
    const next = applyResponseEventToSnapshot(base, {
      ...event(5, 'response.output_text.delta', { delta: 'Hello world' }, 15), firstReplyTextAt: at(10),
    })
    expect(initialResponseDurationMs(next)).toBe(10_000)
  })

  it('accepts timing on an otherwise identical snapshot without regressing text', () => {
    const current = { ...base, sequence: 2, output: [message] }
    const next = mergeResponseSnapshots(current, { ...current, firstReplyTextAt: at(10) })
    expect(initialResponseDurationMs(next)).toBe(10_000)
    expect(next.output).toEqual([message])
  })

  it('stops failures without text at termination and leaves legacy history unknown', () => {
    expect(initialResponseDurationMs(base, at(8))).toBe(8_000)
    expect(initialResponseDurationMs({}, at(8))).toBeUndefined()
    expect(initialResponseDurationMs({ requestReceivedAt: at(10), firstReplyTextAt: at(9) })).toBe(0)
  })
})
