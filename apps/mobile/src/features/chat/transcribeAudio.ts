import type { AudioTranscript } from '@pulpo/contracts'
import { File } from 'expo-file-system'
import { apiRequest } from '../../api/client'

export async function transcribeAudioFile(uri: string, name: string, mimeType: string, signal: AbortSignal): Promise<AudioTranscript> {
  const form = new FormData()
  // Expo fetch needs a Blob for multipart uploads. Override metadata from the local cache path.
  const audio = new File(uri)
  Object.defineProperties(audio, { type: { value: mimeType }, name: { value: name } })
  form.append('file', audio, name)
  return apiRequest<AudioTranscript>('/api/dictation/transcriptions', {
    method: 'POST', body: form, signal, timeoutMs: 45_000,
  })
}
