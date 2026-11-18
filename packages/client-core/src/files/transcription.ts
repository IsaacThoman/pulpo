import { fileExtension } from './display.js'

/** Groq's upload limit for transcribing a stored audio file. */
export const MAX_AUDIO_TRANSCRIPTION_BYTES = 25 * 1024 * 1024

/** Audio Groq transcribes, by the extension it reads the format from. */
const TRANSCRIBABLE_EXTENSIONS: Record<string, string> = {
  flac: 'audio/flac', m4a: 'audio/mp4', mp3: 'audio/mpeg', mpga: 'audio/mpeg', oga: 'audio/ogg',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm',
}
const TRANSCRIBABLE_TYPES: Record<string, string> = {
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a',
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm',
}

/**
 * The upload name and type to transcribe a stored audio file as: its stored type when Groq
 * accepts it, otherwise the one its extension implies. The neutral name keeps the user's
 * filename out of the provider request.
 */
export function transcriptionAudioFormat(name: string, storedType: string | null | undefined): { filename: string; mimeType: string } | null {
  const type = (storedType ?? '').toLowerCase().split(';', 1)[0]!.trim()
  const byType = TRANSCRIBABLE_TYPES[type]
  if (byType) return { filename: `audio.${byType}`, mimeType: type }
  const extension = fileExtension(name)
  const mimeType = TRANSCRIBABLE_EXTENSIONS[extension]
  return mimeType ? { filename: `audio.${extension}`, mimeType } : null
}

/** Whether a stored audio file can be sent for a transcript. */
export function canTranscribeAudio(name: string, storedType: string | null | undefined, sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_AUDIO_TRANSCRIPTION_BYTES && transcriptionAudioFormat(name, storedType) !== null
}
