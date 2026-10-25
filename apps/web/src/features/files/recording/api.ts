import type { FileNode, FileRecording, RecordingClip, RecordingClipMetadata, RecordingSkipUpdate } from '@pulpo/contracts'
import { ApiError, apiRequest, downloadApiFile, fetchApiBlob } from '@/lib/api'
import { uit } from '@/i18n/ui'
import { filesQueryKey, isApiUrl } from '../api'

/** Under the Files prefix, so the 'files' realtime scope refreshes it when a transcript lands. */
export const recordingQueryKey = (userId: string | undefined, id: string) => [...filesQueryKey(userId), 'recording', id] as const

export function createRecording(parentId: string | null, name?: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/recordings', { method: 'POST', body: { parentId, name } })
}

export function fetchRecording(id: string): Promise<FileRecording> {
  return apiRequest<FileRecording>(`/api/files/${id}/recording`)
}

/** Appends a take. The metadata goes first: the server reads it before the audio. */
export function uploadRecordingClip(id: string, audio: Blob, metadata: RecordingClipMetadata, signal?: AbortSignal): Promise<RecordingClip> {
  const form = new FormData()
  form.set('metadata', JSON.stringify(metadata))
  form.set('file', audio, recordingFileName(audio.type))
  return apiRequest<RecordingClip>(`/api/files/${id}/recording/clips`, { method: 'POST', body: form, signal })
}

export function recordingFileName(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'take.m4a'
  if (mimeType.includes('ogg')) return 'take.ogg'
  return 'take.webm'
}

/** Replaces every skipped part of the recording. */
export function updateRecordingSkips(id: string, skips: RecordingSkipUpdate[]): Promise<FileRecording> {
  return apiRequest<FileRecording>(`/api/files/${id}/recording`, { method: 'PATCH', body: { skips } })
}

export function deleteRecordingClip(id: string, clipId: string): Promise<FileRecording> {
  return apiRequest<FileRecording>(`/api/files/${id}/recording/clips/${clipId}`, { method: 'DELETE' })
}

export function retryRecordingTranscript(id: string, clipId: string): Promise<RecordingClip> {
  return apiRequest<RecordingClip>(`/api/files/${id}/recording/clips/${clipId}/transcribe`, { method: 'POST' })
}

function recordingClipUrl(id: string, clipId: string): Promise<{ url: string; name: string; mimeType: string }> {
  return apiRequest<{ url: string; name: string; mimeType: string }>(`/api/files/${id}/recording/clips/${clipId}/download`)
}

/** A take's audio, for playback. */
export async function fetchRecordingClipBlob(id: string, clipId: string, signal?: AbortSignal): Promise<Blob> {
  const { url } = await recordingClipUrl(id, clipId)
  if (isApiUrl(url)) return fetchApiBlob(url, { signal })
  const response = await fetch(url, { signal })
  if (!response.ok) throw new ApiError(response.status, 'file_download_failed', uit`Download failed (${response.status})`)
  return response.blob()
}

export async function downloadRecordingClip(id: string, clipId: string): Promise<void> {
  const { url, name } = await recordingClipUrl(id, clipId)
  if (isApiUrl(url)) return downloadApiFile(url, name)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.click()
}

/** Saves text as a file, e.g. a transcript. */
export function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
