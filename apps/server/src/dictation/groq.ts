const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export class GroqTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GroqTranscriptionError'
  }
}

export interface GroqTranscript {
  text: string
  durationSeconds: number
}

export async function transcribeWithGroq(input: {
  apiKey: string
  audio: Uint8Array
  filename: string
  mimeType: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<GroqTranscript> {
  const form = new FormData()
  form.set('model', GROQ_TRANSCRIPTION_MODEL)
  form.set('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  const bytes = input.audio.buffer.slice(input.audio.byteOffset, input.audio.byteOffset + input.audio.byteLength) as ArrayBuffer
  form.set('file', new Blob([bytes], { type: input.mimeType }), input.filename)
  const response = await (input.fetchImpl ?? fetch)(GROQ_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form,
    signal: input.signal,
  })
  const body = await response.json().catch(() => null) as {
    text?: unknown
    duration?: unknown
    segments?: Array<{ end?: unknown }>
    error?: { message?: unknown }
  } | null
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `Groq returned ${response.status}`
    throw new GroqTranscriptionError(message, response.status)
  }
  if (typeof body?.text !== 'string') throw new GroqTranscriptionError('Groq returned an invalid transcript', 502)
  const reportedDuration = typeof body.duration === 'number' ? body.duration : Number.NaN
  const segmentDuration = Math.max(0, ...(body.segments ?? []).map((segment) => typeof segment.end === 'number' ? segment.end : 0))
  const durationSeconds = Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : segmentDuration
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new GroqTranscriptionError('Groq returned invalid audio duration', 502)
  return { text: body.text.trim(), durationSeconds }
}
