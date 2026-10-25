import type { FileRecording, RecordingClip } from '@pulpo/contracts'
import type { QueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { create } from 'zustand'
import { isNetworkError } from '../../../api/client'
import { getValue, setValue } from '../../../data/database'
import { registerAccountCleanup } from '../../../store/accountCleanup'
import { uploadRecordingClip, type RecordedTake } from '../api'
import { filesErrorMessage } from '../display'
import { filesQueryKeys } from '../queries'

/**
 * Takes recorded on this device that the server doesn't have yet. A finished take is moved out
 * of the recorder's cache and recorded first, so a take whose upload fails, is interrupted by
 * going offline, or by the app ending, is kept and sent later. A recording's takes are sent one
 * at a time, oldest first, so they land in the order they were recorded.
 */
export interface PendingTake extends RecordedTake {
  id: string
  namespace: string
  recordingId: string
  /**
   * `waiting`: queued behind another take of the recording; `offline`: waiting for a connection
   * (sent again on reconnecting); `failed`: refused, until tried again or discarded.
   */
  state: 'waiting' | 'uploading' | 'offline' | 'failed'
  error?: string
}

const STORAGE_KEY = 'files:recording-takes'

export const usePendingTakes = create<{ takes: PendingTake[] }>(() => ({ takes: [] }))

let queryClient: QueryClient | null = null

function takesDirectory(namespace: string): Directory {
  return new Directory(Paths.document, 'pending-takes', encodeURIComponent(namespace))
}

function persist(namespace: string): Promise<void> {
  const takes = usePendingTakes.getState().takes.filter((take) => take.namespace === namespace)
  return setValue(namespace, STORAGE_KEY, takes.map((take) => ({ ...take, state: take.state === 'failed' ? 'failed' : 'waiting' })))
}

function update(id: string, change: Partial<PendingTake>): void {
  usePendingTakes.setState((state) => ({ takes: state.takes.map((take) => take.id === id ? { ...take, ...change } : take) }))
}

function removeFile(uri: string): void {
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // Already gone.
  }
}

/** Adds an uploaded take to the cached recording, so it shows before the next refresh. */
function showUploaded(namespace: string, recordingId: string, clip: RecordingClip): void {
  queryClient?.setQueryData<FileRecording>(filesQueryKeys.recording(namespace, recordingId), (current) => current && !current.clips.some((existing) => existing.id === clip.id)
    ? { ...current, clips: [...current.clips, clip] }
    : current)
  void queryClient?.invalidateQueries({ queryKey: filesQueryKeys.all(namespace) })
}

const sending = new Set<string>()

/** Sends the recording's takes in order until one can't be sent. */
async function send(namespace: string, recordingId: string): Promise<void> {
  const key = `${namespace}|${recordingId}`
  if (sending.has(key)) return
  sending.add(key)
  try {
    for (;;) {
      const queued = usePendingTakes.getState().takes
        .filter((take) => take.namespace === namespace && take.recordingId === recordingId)
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
      const next = queued[0]
      // A take that was refused holds back the ones after it, which must not land before it.
      if (!next || next.state === 'failed' || next.state === 'offline') return
      update(next.id, { state: 'uploading', error: undefined })
      try {
        const clip = await uploadRecordingClip(recordingId, next)
        usePendingTakes.setState((state) => ({ takes: state.takes.filter((take) => take.id !== next.id) }))
        removeFile(next.uri)
        await persist(namespace).catch(() => undefined)
        showUploaded(namespace, recordingId, clip)
      } catch (error) {
        const offline = isNetworkError(error)
        update(next.id, { state: offline ? 'offline' : 'failed', error: offline ? 'Waiting for a connection' : filesErrorMessage(error) })
        await persist(namespace).catch(() => undefined)
        return
      }
    }
  } finally {
    sending.delete(key)
  }
}

/**
 * Keeps a just-finished take on this device and starts sending it. Resolves once it is kept;
 * the take's recorder file is moved, so it no longer exists at `take.uri` afterwards.
 */
export async function keepTake(namespace: string, recordingId: string, take: RecordedTake, client: QueryClient): Promise<PendingTake> {
  queryClient = client
  const id = Crypto.randomUUID()
  const directory = takesDirectory(namespace)
  directory.create({ idempotent: true, intermediates: true })
  const destination = new File(directory, `${id}.m4a`)
  await new File(take.uri).copy(destination)
  removeFile(take.uri)
  const pending: PendingTake = { ...take, uri: destination.uri, id, namespace, recordingId, state: 'waiting' }
  usePendingTakes.setState((state) => ({ takes: [...state.takes, pending] }))
  await persist(namespace)
  void send(namespace, recordingId)
  return pending
}

/** Loads the account's unsent takes (once) and sends those waiting for a connection. */
const loaded = new Set<string>()
export async function resumeTakes(namespace: string, client: QueryClient): Promise<void> {
  queryClient = client
  if (!loaded.has(namespace)) {
    loaded.add(namespace)
    const stored = await getValue<PendingTake[]>(namespace, STORAGE_KEY) ?? []
    const known = new Set(usePendingTakes.getState().takes.map((take) => take.id))
    const restored = stored.filter((take) => !known.has(take.id) && new File(take.uri).exists)
    if (restored.length) usePendingTakes.setState((state) => ({ takes: [...state.takes, ...restored] }))
  }
  usePendingTakes.setState((state) => ({
    takes: state.takes.map((take) => take.namespace === namespace && take.state === 'offline' ? { ...take, state: 'waiting', error: undefined } : take),
  }))
  const recordings = new Set(usePendingTakes.getState().takes.filter((take) => take.namespace === namespace).map((take) => take.recordingId))
  for (const recordingId of recordings) void send(namespace, recordingId)
}

export function retryTake(id: string): void {
  const take = usePendingTakes.getState().takes.find((candidate) => candidate.id === id)
  if (!take || take.state === 'uploading') return
  update(id, { state: 'waiting', error: undefined })
  void send(take.namespace, take.recordingId)
}

/** Throws an unsent take away; the takes after it are sent. */
export async function discardTake(id: string): Promise<void> {
  const take = usePendingTakes.getState().takes.find((candidate) => candidate.id === id)
  if (!take || take.state === 'uploading') return
  usePendingTakes.setState((state) => ({ takes: state.takes.filter((candidate) => candidate.id !== id) }))
  removeFile(take.uri)
  await persist(take.namespace).catch(() => undefined)
  void send(take.namespace, take.recordingId)
}

// Signing out forgets the account's unsent takes and removes their audio.
registerAccountCleanup(async (namespace) => {
  usePendingTakes.setState((state) => ({ takes: state.takes.filter((take) => take.namespace !== namespace) }))
  loaded.delete(namespace)
  try {
    const directory = takesDirectory(namespace)
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to remove.
  }
})
