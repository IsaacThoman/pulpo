import { describe, expect, it, vi } from 'vitest'
import { createProviderCostCapture } from './provider-cost.js'

describe('Agent provider cost capture', () => {
  it('captures provider-reported cost from the terminal SSE event', async () => {
    const body = [
      'data: {"type":"response.created","response":{"usage":null}}',
      'data: {"type":"response.completed","response":{"usage":{"cost":0.000123}}}',
      'data: [DONE]',
    ].join('\n\n')
    const baseFetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const capture = createProviderCostCapture(baseFetch)
    const response = await capture.fetch('https://provider.example/responses')
    expect(await response.text()).toBe(body)
    expect(await capture.costMicros()).toBe(123)
  })

  it('returns undefined when the provider omits cost', async () => {
    const baseFetch = vi.fn(async () => new Response('data: {"type":"response.completed","response":{"usage":{}}}\n\n'))
    const capture = createProviderCostCapture(baseFetch)
    await capture.fetch('https://provider.example/responses')
    expect(await capture.costMicros()).toBeUndefined()
  })
})
