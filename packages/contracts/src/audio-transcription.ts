export const MAX_AUDIO_TRANSCRIPTION_BYTES = 10 * 1024 * 1024

const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/flac', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
])

export function audioTranscriptionMimeType(mimeType: string | null | undefined): string | null {
  const type = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (type === 'audio/x-flac') return 'audio/flac'
  if (type === 'audio/x-m4a' || type === 'audio/m4a') return 'audio/mp4'
  return type && SUPPORTED_AUDIO_TYPES.has(type) ? type : null
}

export interface AudioTranscriptSegment {
  start: number
  end: number
  text: string
}

export interface AudioTranscript {
  text: string
  segments?: AudioTranscriptSegment[]
}
