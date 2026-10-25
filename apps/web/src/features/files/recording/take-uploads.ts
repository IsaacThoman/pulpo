import type { FileRecording, RecordingClipMetadata } from '@pulpo/contracts'
import { create } from 'zustand'
import { filesErrorMessage } from '@/features/files/file-display'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { recordingQueryKey, uploadRecordingClip } from './api'

/** A finished take on its way to the server, or one that failed to get there. */
export interface PendingTake {
  key: string
  recordingId: string
  audio: Blob
  metadata: RecordingClipMetadata & { durationMs: number }
  status: 'waiting' | 'uploading' | 'failed'
  error: string | null
}

/**
 * Takes waiting to be saved, outside any page so a take finished on the way out of a recording
 * still uploads. Each recording's takes go up one at a time, in the order they were recorded,
 * since the server appends them; a failure holds the ones after it until it is retried.
 */
export const useTakeUploads = create<{ takes: PendingTake[] }>()(() => ({ takes: [] }))

const pumping = new Set<string>()

function patch(key: string, next: Partial<PendingTake>) {
  useTakeUploads.setState((state) => ({ takes: state.takes.map((take) => take.key === key ? { ...take, ...next } : take) }))
}

async function pump(recordingId: string) {
  if (pumping.has(recordingId)) return
  pumping.add(recordingId)
  try {
    for (;;) {
      const take = useTakeUploads.getState().takes.find((candidate) => candidate.recordingId === recordingId)
      if (!take || take.status === 'failed') return
      patch(take.key, { status: 'uploading', error: null })
      try {
        const clip = await uploadRecordingClip(recordingId, take.audio, take.metadata)
        useTakeUploads.setState((state) => ({ takes: state.takes.filter((candidate) => candidate.key !== take.key) }))
        const key = recordingQueryKey(useAuth.getState().user?.id, recordingId)
        // Shown right away; the refetch brings the recording's new size and anything else that changed.
        queryClient.setQueryData<FileRecording>(key, (current) => current && !current.clips.some((existing) => existing.id === clip.id)
          ? { ...current, clips: [...current.clips, clip] }
          : current)
        void queryClient.invalidateQueries({ queryKey: key })
      } catch (cause) {
        patch(take.key, { status: 'failed', error: filesErrorMessage(cause) })
        return
      }
    }
  } finally {
    pumping.delete(recordingId)
  }
}

export function queueTake(recordingId: string, audio: Blob, metadata: PendingTake['metadata']) {
  const take: PendingTake = { key: crypto.randomUUID(), recordingId, audio, metadata, status: 'waiting', error: null }
  useTakeUploads.setState((state) => ({ takes: [...state.takes, take] }))
  void pump(recordingId)
}

export function retryTake(key: string) {
  const take = useTakeUploads.getState().takes.find((candidate) => candidate.key === key)
  if (!take) return
  patch(key, { status: 'waiting', error: null })
  void pump(take.recordingId)
}

export function discardTake(key: string) {
  const take = useTakeUploads.getState().takes.find((candidate) => candidate.key === key)
  useTakeUploads.setState((state) => ({ takes: state.takes.filter((candidate) => candidate.key !== key) }))
  if (take) void pump(take.recordingId)
}

// Closing the tab would lose takes that are not saved yet.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (useTakeUploads.getState().takes.length) event.preventDefault()
  })
}
