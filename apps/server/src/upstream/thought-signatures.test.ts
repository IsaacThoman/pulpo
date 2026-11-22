import { describe, expect, it } from 'vitest'
import {
  GEMINI_SKIP_THOUGHT_SIGNATURE,
  createThoughtSignatureStore,
  isGeminiApiBaseUrl,
  thoughtSignaturesFromBody,
  withThoughtSignatures,
} from './thought-signatures.js'

const sse = (...chunks: unknown[]) => `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`
const signedCall = (id: string, signature: string, index = 0) => ({
  index, id, type: 'function', function: { name: 'get_date', arguments: '{}' },
  extra_content: { google: { thought_signature: signature } },
})
const payload = (...ids: string[]) => ({
  model: 'gemini-4-hydrogen',
  messages: [
    { role: 'user', content: 'What is the date?' },
    { role: 'assistant', content: null, tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'get_date', arguments: '{}' } })) },
    ...ids.map((id) => ({ role: 'tool', tool_call_id: id, content: '2026-11-14' })),
  ],
})
const signatureOf = (body: unknown, position: number) =>
  ((body as { messages: Array<{ tool_calls?: Array<{ extra_content?: { google?: { thought_signature?: string } } }> }> }).messages[1]!.tool_calls![position]!.extra_content?.google?.thought_signature)

describe('isGeminiApiBaseUrl', () => {
  it('matches only the Gemini API host', () => {
    expect(isGeminiApiBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(true)
    expect(isGeminiApiBaseUrl('https://openrouter.ai/api/v1')).toBe(false)
    expect(isGeminiApiBaseUrl('not a url')).toBe(false)
  })
})

describe('thoughtSignaturesFromBody', () => {
  it('reads signatures from streamed tool calls, following ids across deltas', () => {
    const body = sse(
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_date', arguments: '' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{}' }, extra_content: { google: { thought_signature: 'sig-a' } } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [signedCall('call_b', 'sig-b', 1)] }, finish_reason: 'tool_calls' }] },
    )
    expect(Object.fromEntries(thoughtSignaturesFromBody(body))).toEqual({ call_a: 'sig-a', call_b: 'sig-b' })
  })

  it('reads signatures from a non-streamed body', () => {
    const body = JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', tool_calls: [signedCall('call_a', 'sig-a')] } }] })
    expect(Object.fromEntries(thoughtSignaturesFromBody(body))).toEqual({ call_a: 'sig-a' })
  })
})

describe('withThoughtSignatures', () => {
  it('restores known signatures and leaves unknown calls alone without the placeholder', () => {
    const body = withThoughtSignatures(payload('call_a', 'call_b'), new Map([['call_a', 'sig-a']]), { placeholder: false })
    expect(signatureOf(body, 0)).toBe('sig-a')
    expect(signatureOf(body, 1)).toBeUndefined()
  })

  it('uses the placeholder for unsigned calls when asked', () => {
    const body = withThoughtSignatures(payload('call_a', 'call_b'), new Map([['call_a', 'sig-a']]), { placeholder: true })
    expect(signatureOf(body, 0)).toBe('sig-a')
    expect(signatureOf(body, 1)).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE)
  })

  it('keeps a signature the payload already carries and returns untouched payloads as is', () => {
    const signed = { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: null, tool_calls: [signedCall('call_a', 'own')] }] }
    expect(withThoughtSignatures(signed, new Map([['call_a', 'other']]), { placeholder: true })).toBe(signed)
    const plain = { messages: [{ role: 'user', content: 'hi' }] }
    expect(withThoughtSignatures(plain, new Map(), { placeholder: true })).toBe(plain)
  })
})

describe('createThoughtSignatureStore', () => {
  it('carries signatures from one response into the next request', async () => {
    const store = createThoughtSignatureStore()
    const upstream = async () => new Response(sse({ choices: [{ index: 0, delta: { tool_calls: [signedCall('call_a', 'sig-a')] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'text/event-stream' } })
    const response = await store.fetch(upstream as typeof fetch)('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    // The caller still reads the full stream.
    expect(await response.text()).toContain('sig-a')
    expect(signatureOf(await store.apply(payload('call_a'), { placeholder: false }), 0)).toBe('sig-a')
  })

  it('ignores failed responses', async () => {
    const store = createThoughtSignatureStore()
    const upstream = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [signedCall('call_a', 'sig-a')] } }] }), { status: 500 })
    await store.fetch(upstream as typeof fetch)('https://example.test')
    expect(signatureOf(await store.apply(payload('call_a'), { placeholder: false }), 0)).toBeUndefined()
  })
})
