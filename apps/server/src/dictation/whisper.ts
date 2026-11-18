import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import type { getConfig } from '../config.js'
import type { DictationTranscript } from './transcript.js'

export function getWhisperConnection(config: ReturnType<typeof getConfig>) {
  const { PULPO_DICTATION_WHISPER_URL: url, PULPO_DICTATION_WHISPER_TOKEN: token } = config
  return url && token ? { url, token } : null
}

export class WhisperTranscriptionError extends Error {
  constructor(readonly status: number) {
    super(`Whisper transcription failed (HTTP ${status})`)
    this.name = 'WhisperTranscriptionError'
  }
}

const jobId = z.object({ id: z.uuid() })
const jobStatus = z.discriminatedUnion('stage', [
  z.object({ stage: z.enum(['decoding', 'transcribing', 'failed']) }),
  z.object({
    stage: z.literal('done'),
    result: z.object({
      text: z.string().trim(),
      durationSeconds: z.number().positive(),
      segments: z.array(z.object({
        t0Ms: z.number().nonnegative(),
        t1Ms: z.number().nonnegative(),
        text: z.string().trim(),
      }).refine((segment) => segment.t1Ms >= segment.t0Ms)),
    }),
  }),
])

async function readResponse<T>(response: Response, schema: z.ZodType<T>, expectedStatus: number): Promise<T> {
  if (response.status !== expectedStatus) {
    await response.body?.cancel()
    throw new WhisperTranscriptionError(response.ok ? 502 : response.status)
  }
  const result = schema.safeParse(await response.json().catch(() => null))
  if (!result.success) throw new WhisperTranscriptionError(502)
  return result.data
}

export async function transcribeWithWhisper(input: {
  connection: NonNullable<ReturnType<typeof getWhisperConnection>>
  audio: Uint8Array
  signal: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<DictationTranscript> {
  const fetcher = input.fetchImpl ?? fetch
  const url = new URL('/api/pulpo/jobs', input.connection.url)
  const headers = { authorization: `Bearer ${input.connection.token}` }
  const bytes = input.audio.buffer.slice(input.audio.byteOffset, input.audio.byteOffset + input.audio.byteLength) as ArrayBuffer
  const { id } = await readResponse(await fetcher(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    body: bytes,
    signal: input.signal,
    redirect: 'error',
  }), jobId, 202)

  const statusUrl = new URL(`${url.pathname}/${id}`, url)
  for (;;) {
    const job = await readResponse(await fetcher(statusUrl, {
      headers, signal: input.signal, redirect: 'error',
    }), jobStatus, 200)
    if (job.stage === 'failed') throw new WhisperTranscriptionError(502)
    if (job.stage === 'done') {
      const { text, durationSeconds } = job.result
      const segments = job.result.segments.filter((segment) => segment.text).map((segment) => ({
        start: segment.t0Ms / 1000,
        end: segment.t1Ms / 1000,
        text: segment.text,
      }))
      return { text, durationSeconds, ...(segments.length > 0 && { segments }) }
    }
    await setTimeout(400, undefined, { signal: input.signal })
  }
}
