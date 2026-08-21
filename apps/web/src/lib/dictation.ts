export const MAX_DICTATION_DURATION_MS = 60 * 60 * 1_000
export const DICTATION_AUDIO_BITS_PER_SECOND = 32_000

export function preferredDictationMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find((type) => MediaRecorder.isTypeSupported(type))
}

export function dictationFilename(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'dictation.m4a'
  if (mimeType.includes('ogg')) return 'dictation.ogg'
  return 'dictation.webm'
}

export function insertDictationText(current: string, transcript: string, start: number, end = start): { value: string; cursor: number } {
  const clean = transcript.trim()
  if (!clean) return { value: current, cursor: Math.max(0, Math.min(start, current.length)) }
  const from = Math.max(0, Math.min(start, current.length))
  const to = Math.max(from, Math.min(end, current.length))
  const before = current.slice(0, from)
  const after = current.slice(to)
  const inserted = `${before && !/\s$/.test(before) ? ' ' : ''}${clean}${after && !/^\s/.test(after) ? ' ' : ''}`
  return { value: before + inserted + after, cursor: before.length + inserted.length - (after && !/^\s/.test(after) ? 1 : 0) }
}
