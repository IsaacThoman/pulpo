import { describe, expect, it, vi } from 'vitest'
import { GroqTranscriptionError, transcribeWithGroq } from './groq.js'

describe('Groq transcription client', () => {
  it('uploads browser audio with the configured Whisper model', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: ' Hello world. ', duration: 12.1 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const text = await transcribeWithGroq({
      apiKey: 'groq-secret', audio: new Uint8Array([1, 2, 3]), filename: 'dictation.webm', mimeType: 'audio/webm', fetchImpl: fetch,
    })
    expect(text).toEqual({ text: 'Hello world.', durationSeconds: 12.1, segments: [] })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(init.headers).toEqual({ authorization: 'Bearer groq-secret' })
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
    expect((init.body as FormData).get('response_format')).toBe('verbose_json')
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)
  })

  it('falls back to the final segment timestamp for duration', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello there',
      segments: [{ start: 0, end: 4.2, text: ' Hello' }, { start: 4.2, end: 9.75, text: ' there ' }],
    }), { status: 200 }))
    await expect(transcribeWithGroq({
      apiKey: 'secret', audio: new Uint8Array([1]), filename: 'audio.webm', mimeType: 'audio/webm', fetchImpl: fetch,
    })).resolves.toEqual({
      text: 'Hello there',
      durationSeconds: 9.75,
      segments: [{ start: 0, end: 4.2, text: 'Hello' }, { start: 4.2, end: 9.75, text: 'there' }],
    })
  })

  it('drops malformed and empty segments', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Kept', duration: 3,
      segments: [{ start: 0, end: 1, text: '  ' }, { start: 'x', end: 2, text: 'Bad' }, { start: -0.1, end: 3, text: 'Kept' }, null],
    }), { status: 200 }))
    await expect(transcribeWithGroq({
      apiKey: 'secret', audio: new Uint8Array([1]), filename: 'audio.mp3', mimeType: 'audio/mpeg', fetchImpl: fetch,
    })).resolves.toEqual({ text: 'Kept', durationSeconds: 3, segments: [{ start: 0, end: 3, text: 'Kept' }] })
  })

  it('maps provider errors without accepting an invalid transcript', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 }))
    const error = await transcribeWithGroq({
      apiKey: 'secret', audio: new Uint8Array([1]), filename: 'audio.webm', mimeType: 'audio/webm', fetchImpl: fetch,
    }).catch((cause) => cause)
    expect(error).toBeInstanceOf(GroqTranscriptionError)
    expect(error).toMatchObject({ name: 'GroqTranscriptionError', message: 'Rate limited', status: 429 })
  })
})
