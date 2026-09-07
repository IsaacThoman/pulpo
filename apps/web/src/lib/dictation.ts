export { insertDictationText } from '@pulpo/client-core'

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
