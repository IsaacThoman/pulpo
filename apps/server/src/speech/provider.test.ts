import { describe, expect, it, vi } from 'vitest'
import { OPENAI_SPEECH_PRESET, speechModelSchema, type SpeechModel, type SpeechRequest } from '@pulpo/contracts'
import { generateSpeech, speechCost } from './provider.js'
const model = speechModelSchema.parse({ ...OPENAI_SPEECH_PRESET, id: 'test', providerConnectionId: '11111111-1111-4111-8111-111111111111', responseFormat: 'wav' })
const input: SpeechRequest = { requestId: '22222222-2222-4222-8222-222222222222', modelId: 'test', input: 'Hello', voice: 'coral', instructions: 'Calm', speed: 1 }
function wav() {
  const buffer = Buffer.alloc(44 + 48000)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(48000, 40); return buffer
}
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`
const options = (m = model) => ({ model: m, input, baseUrl: 'https://provider.example/openai/v1/', apiKey: 'secret', signal: new AbortController().signal })
describe('speech provider', () => {
  it('handles SSE split across arbitrary network boundaries, audio and authoritative usage', async () => {
    const value = event({ type: 'speech.audio.delta', audio: wav().toString('base64') }) + event({ type: 'speech.audio.done', usage: { input_tokens: 12, output_tokens: 50, total_tokens: 62 } })
    const bytes = new TextEncoder().encode(value)
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17)); controller.close() } })
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const result = await generateSpeech(options({ ...model, billUsers: true }), fetcher)
    expect(result.durationSeconds).toBe(1); expect(result.usage?.output_tokens).toBe(50)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://provider.example/openai/v1/audio/speech')
    expect(JSON.parse(request.body as string)).toMatchObject({ model: 'gpt-4o-mini-tts', instructions: 'Calm', stream_format: 'sse', speed: 1 })
    expect(request.redirect).toBe('error')
  })
  it('accepts binary WAV and measures duration without client metadata', async () => {
    const result = await generateSpeech(options({ ...model, supportsSse: false }), async () => new Response(wav()))
    expect(result.durationSeconds).toBe(1); expect(result.audio.length).toBe(48044)
  })
  it('rejects missing token usage, malformed audio, and incomplete SSE', async () => {
    const stream = event({ type: 'speech.audio.delta', audio: wav().toString('base64') })
    await expect(generateSpeech(options({ ...model, billUsers: true }), async () => new Response(stream + event({ type: 'speech.audio.done' })))).rejects.toThrow()
    await expect(generateSpeech(options(), async () => new Response(stream))).rejects.toThrow()
    await expect(generateSpeech(options({ ...model, supportsSse: false }), async () => new Response('not audio'))).rejects.toThrow()
  })
  it('sanitizes provider failures and does not retry', async () => {
    const fetcher = vi.fn(async () => new Response('secret provider payload', { status: 500 }))
    await expect(generateSpeech(options(), fetcher)).rejects.toThrow('Speech generation failed'); expect(fetcher).toHaveBeenCalledOnce()
  })
})
describe('speech billing', () => {
  const bill = (patch: Partial<SpeechModel>) => ({ ...model, billUsers: true, ...patch })
  it('bills input and output tokens independently using integer micros', () => {
    expect(speechCost(bill({}), 'Hello', 1, { input_tokens: 1000, output_tokens: 1000 })).toBe(12600)
    expect(() => speechCost(bill({}), 'Hello', 1)).toThrow('Token billing requires valid provider-reported input text and output audio token usage')
    expect(() => speechCost(bill({}), 'Hello', 1, { input_tokens: NaN, output_tokens: 1 })).toThrow()
  })
  it('counts Unicode characters and generated milliseconds', () => {
    expect(speechCost(bill({ billingUnit: 'characters', characterPriceMicros: 1000 }), '👋世', 1)).toBe(2)
    expect(speechCost(bill({ billingUnit: 'duration', minutePriceMicros: 60000 }), 'Hello', 1.25)).toBe(1250)
    expect(speechCost(model, 'Hello', 1)).toBe(0)
  })
})
