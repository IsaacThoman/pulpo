const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export class GroqTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GroqTranscriptionError'
  }
}

export interface GroqTranscriptSegment {
  /** Seconds from the start of the audio. */
  start: number
  end: number
  text: string
}

export interface GroqTranscript {
  text: string
  durationSeconds: number
  /** Timed phrases, in order, with empty ones dropped. */
  segments: GroqTranscriptSegment[]
}

function transcriptSegments(value: unknown): GroqTranscriptSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((segment: { start?: unknown; end?: unknown; text?: unknown }) => {
    if (typeof segment?.start !== 'number' || typeof segment.end !== 'number' || typeof segment.text !== 'string') return []
    const text = segment.text.trim()
    if (!text || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return []
    const start = Math.max(0, segment.start)
    return [{ start, end: Math.max(start, segment.end), text }]
  })
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
    segments?: unknown
    error?: { message?: unknown }
  } | null
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `Groq returned ${response.status}`
    throw new GroqTranscriptionError(message, response.status)
  }
  if (typeof body?.text !== 'string') throw new GroqTranscriptionError('Groq returned an invalid transcript', 502)
  const reportedDuration = typeof body.duration === 'number' ? body.duration : Number.NaN
  const segments = transcriptSegments(body.segments)
  const segmentDuration = Math.max(0, ...segments.map((segment) => segment.end))
  const durationSeconds = Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : segmentDuration
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new GroqTranscriptionError('Groq returned invalid audio duration', 502)
  return { text: body.text.trim(), durationSeconds, segments }
}
