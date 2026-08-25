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

export function formatDictationTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`
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
