const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export class GroqTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GroqTranscriptionError'
  }
}

export async function transcribeWithGroq(input: {
  apiKey: string
  audio: Uint8Array
  filename: string
  mimeType: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<string> {
  const form = new FormData()
  form.set('model', GROQ_TRANSCRIPTION_MODEL)
  form.set('response_format', 'json')
  const bytes = input.audio.buffer.slice(input.audio.byteOffset, input.audio.byteOffset + input.audio.byteLength) as ArrayBuffer
  form.set('file', new Blob([bytes], { type: input.mimeType }), input.filename)
  const response = await (input.fetchImpl ?? fetch)(GROQ_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form,
    signal: input.signal,
  })
  const body = await response.json().catch(() => null) as { text?: unknown; error?: { message?: unknown } } | null
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `Groq returned ${response.status}`
    throw new GroqTranscriptionError(message, response.status)
  }
  if (typeof body?.text !== 'string') throw new GroqTranscriptionError('Groq returned an invalid transcript', 502)
  return body.text.trim()
}
