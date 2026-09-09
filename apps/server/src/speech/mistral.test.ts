import { expect, it, vi } from 'vitest'
import { speechModelSchema, VOXTRAL_SPEECH_PRESET } from '@pulpo/contracts'
import { generateSpeech } from './provider.js'
import { boundedJson, decodeSpeechBase64, listMistralVoices, mistralRequest } from './mistral.js'
import { speechTestWav } from './audio-fixtures.js'
const connection = { baseUrl: 'https://api.mistral.ai/v1/', apiKey: 'secret', signal: new AbortController().signal }
const model = speechModelSchema.parse({ ...VOXTRAL_SPEECH_PRESET, id: 'voxtral', providerConnectionId: '11111111-1111-4111-8111-111111111111', responseFormat: 'wav' })
it('uses the Mistral wire protocol and private clone binding, without OpenAI controls or invented usage', async () => {
  const fetcher = vi.fn(async () => Response.json({ audio_data: speechTestWav().toString('base64') }))
  const result = await generateSpeech({ ...connection, model, upstreamVoiceId: 'private-provider-id', input: { requestId: '11111111-1111-4111-8111-111111111111', modelId: model.id, voice: 'local-voice', input: 'Bonjour.' } }, fetcher)
  expect(result.durationSeconds).toBe(1); expect(result.usage).toBeUndefined()
  const call = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(call[0]).toBe('https://api.mistral.ai/v1/audio/speech')
  expect(JSON.parse(call[1].body as string)).toEqual({ model: 'voxtral-mini-tts-2603', input: 'Bonjour.', voice_id: 'private-provider-id', response_format: 'wav', stream: false })
})
it('loads all provider voice pages without losing custom voice metadata', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Voice ${i}`, user_id: null })), total: 101 })).mockResolvedValueOnce(Response.json({ items: [{ id: 'custom', name: 'Custom', languages: ['fr'], user_id: 'user', slug: 'pulpo-test' }], total: 101 }))
  const voices = await listMistralVoices(connection, fetcher)
  expect(voices).toHaveLength(101); expect(voices.at(-1)).toMatchObject({ id: 'custom', custom: true, languages: ['fr'], slug: 'pulpo-test' })
  expect(fetcher.mock.calls[1]![0]).toContain('offset=100')
})
it('bounds encoded and decoded data and rejects malformed responses', async () => {
  for (const value of ['', '%%%=', 'YQ=', 'YQ==garbage', null]) expect(() => decodeSpeechBase64(value)).toThrow()
  await expect(boundedJson(new Response('x'.repeat(101)), 100)).rejects.toThrow('invalid response')
  const fetcher = vi.fn(async () => new Response('provider secret', { status: 404 }))
  await expect(mistralRequest(connection, '/audio/speech', 'POST', {}, fetcher)).rejects.toMatchObject({ code: 'speech_voice_missing' })
  expect(fetcher).toHaveBeenCalledOnce()
})
it('reads provider samples as bounded binary audio', async () => {
  const sample = speechTestWav()
  expect(await mistralRequest(connection, '/audio/voices/voice/sample', 'GET', undefined, async () => new Response(sample), true)).toEqual(sample)
})
it('respects smaller provider pages and rejects incomplete pagination', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ id: 'first', name: 'First' }], total: 2 })).mockResolvedValueOnce(Response.json({ items: [{ id: 'second', name: 'Second' }], total: 2 }))
  expect(await listMistralVoices(connection, fetcher)).toHaveLength(2)
  expect(fetcher.mock.calls[1]![0]).toContain('offset=1')
  await expect(listMistralVoices(connection, async () => Response.json({ items: [], total: 1 }))).rejects.toThrow('completely')
})
it('passes cancellation through generation and accepts no-content deletion', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })))
  const pending = generateSpeech({ ...connection, signal: controller.signal, model, input: { requestId: '11111111-1111-4111-8111-111111111111', modelId: model.id, voice: 'voice', input: 'Hello' } }, fetcher)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(await mistralRequest(connection, '/audio/voices/voice', 'DELETE', undefined, async () => new Response(null, { status: 204 }))).toBeNull()
})
