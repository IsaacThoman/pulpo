import type { AudioTranscript } from '@pulpo/contracts'
import type { DictationTranscript } from './transcript.js'

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
}): Promise<DictationTranscript> {
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
    segments?: Array<{ start?: unknown; end?: unknown; text?: unknown } | null>
    error?: { message?: unknown }
  } | null
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `Groq returned ${response.status}`
    throw new GroqTranscriptionError(message, response.status)
  }
  if (typeof body?.text !== 'string') throw new GroqTranscriptionError('Groq returned an invalid transcript', 502)
  const reportedDuration = typeof body.duration === 'number' ? body.duration : Number.NaN
  const chunks = Array.isArray(body.segments) ? body.segments : []
  let segmentDuration = 0
  const segments: NonNullable<AudioTranscript['segments']> = []
  for (const chunk of chunks) {
    if (!chunk || typeof chunk.end !== 'number' || !Number.isFinite(chunk.end)) continue
    segmentDuration = Math.max(segmentDuration, chunk.end)
    const { start, end, text } = chunk
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || end < start || typeof text !== 'string' || !text.trim()) continue
    segments.push({ start, end, text: text.trim() })
  }
  const durationSeconds = Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : segmentDuration
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new GroqTranscriptionError('Groq returned invalid audio duration', 502)
  return { text: body.text.trim(), durationSeconds, ...(segments.length > 0 && { segments }) }
}
