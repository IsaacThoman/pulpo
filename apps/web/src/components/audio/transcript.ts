import type { AudioTranscript, AudioTranscriptSegment } from '@pulpo/contracts'
import { ApiError, apiRequest } from '@/lib/api'
import { ui } from '@/i18n/ui'

/** Stored audio a transcript can be made from. */
export type TranscriptSource = { kind: 'attachment' | 'file'; id: string; revision?: number }

export function audioTranscriptQueryKey(userId: string | undefined, source: TranscriptSource) {
  return ['audio-transcript', userId, source.kind, source.id, source.revision ?? 0] as const
}

export function fetchAudioTranscript(source: TranscriptSource): Promise<AudioTranscript> {
  const path = source.kind === 'attachment' ? `/api/attachments/${source.id}/transcription` : `/api/files/${source.id}/transcription`
  return apiRequest<AudioTranscript>(path, { method: 'POST' })
}

/**
 * The segment being spoken at `time`: the last one started by then, held through any pause
 * before the next. Null before the first segment begins.
 */
export function activeSegmentIndex(segments: readonly AudioTranscriptSegment[], time: number): number | null {
  let low = 0
  let high = segments.length - 1
  let found: number | null = null
  while (low <= high) {
    const middle = (low + high) >> 1
    if (segments[middle]!.start <= time) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

export function transcriptErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'dictation_no_speech') return ui("No speech was detected in this audio.")
    if (error.code === 'transcription_audio_too_large') return ui("Audio must be 25 MB or smaller to transcribe.")
    if (error.code === 'transcription_audio_type_unsupported') return ui("This audio format can’t be transcribed.")
    if (error.code === 'dictation_provider_rate_limited' || error.status === 429) return ui("Transcription is busy right now. Try again shortly.")
    if (error.code === 'dictation_disabled') return ui("Transcription isn’t available on this server.")
    // Billing limits and similar refusals explain themselves.
    if (error.status < 500 && error.message) return error.message
  }
  return ui("This audio couldn’t be transcribed. Try again.")
}

/** `m:ss`, or `h:mm:ss` for long recordings. */
export function audioClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
