import type { QueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { create } from 'zustand'
import { isNetworkError } from '../../api/client'
import { getValue, setValue } from '../../data/database'
import { deleteFileNode, uploadFile, type LocalUpload } from './api'
import { filesErrorMessage } from './display'
import { refreshFiles } from './operations'
import { useFilesToasts } from './toasts'

/**
 * Files uploads. Picked files are copied into the app's own storage and recorded first, so an
 * upload interrupted by going offline, backgrounding, or the app ending resumes on the next
 * launch. A resumed upload releases the reservation its interrupted attempt left behind.
 */
export interface QueuedUpload extends LocalUpload {
  id: string
  namespace: string
  parentId: string | null
  /** The placeholder the server made for the attempt in progress, released if it is retried. */
  reservedNodeId?: string
  /** `offline`: waiting for a connection; `resumeUploads` (on reconnect or launch) retries it. */
  state: 'waiting' | 'uploading' | 'offline' | 'failed'
  error?: string
  attempts: number
}

const STORAGE_KEY = 'files:uploads'
const CONCURRENCY = 3

export const useFileUploads = create<{ items: QueuedUpload[] }>(() => ({ items: [] }))

function persist(namespace: string): Promise<void> {
  const items = useFileUploads.getState().items.filter((item) => item.namespace === namespace)
  // An upload in progress when the app ends starts over; its stale reservation is released first.
  return setValue(namespace, STORAGE_KEY, items.map((item) => ({ ...item, state: item.state === 'uploading' || item.state === 'offline' ? 'waiting' : item.state })))
}

function update(id: string, change: Partial<QueuedUpload>): void {
  useFileUploads.setState((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...change } : item) }))
}

function remove(id: string): void {
  useFileUploads.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }))
}

function pendingDirectory(): Directory {
  const directory = new Directory(Paths.document, 'pending-uploads')
  directory.create({ idempotent: true, intermediates: true })
  return directory
}

/** Copies a picked file somewhere it survives the picker's temporary files being cleared. */
async function stage(source: LocalUpload): Promise<LocalUpload> {
  const directory = new Directory(pendingDirectory(), Crypto.randomUUID())
  directory.create({ idempotent: true, intermediates: true })
  const destination = new File(directory, source.name.replace(/[\\/]/g, '-') || 'file')
  await new File(source.uri).copy(destination)
  return { ...source, uri: destination.uri, sizeBytes: destination.size || source.sizeBytes }
}

function discardStaged(uri: string): void {
  try {
    const file = new File(uri)
    const parent = file.parentDirectory
    if (file.exists) file.delete()
    if (parent.exists && parent.uri.includes('pending-uploads')) parent.delete()
  } catch {
    // Already gone.
  }
}

let running = 0
let queryClient: QueryClient | null = null

function pump(): void {
  while (running < CONCURRENCY) {
    const next = useFileUploads.getState().items.find((item) => item.state === 'waiting')
    if (!next) return
    running += 1
    update(next.id, { state: 'uploading', error: undefined })
    void runUpload(next).finally(() => {
      running -= 1
      pump()
    })
  }
}

async function runUpload(item: QueuedUpload): Promise<void> {
  try {
    // An earlier attempt's placeholder would otherwise take the name and wait 24 hours to be purged.
    if (item.reservedNodeId) await deleteFileNode(item.reservedNodeId).catch(() => undefined)
    await uploadFile(item.parentId, item, {
      onReserved: (reserved) => {
        update(item.id, { reservedNodeId: reserved.id })
        void persist(item.namespace)
        if (queryClient) void refreshFiles(queryClient, item.namespace)
      },
    })
    remove(item.id)
    discardStaged(item.uri)
    await persist(item.namespace)
    if (queryClient) await refreshFiles(queryClient, item.namespace)
  } catch (error) {
    const offline = isNetworkError(error)
    update(item.id, {
      // The upload helper releases its own reservation when it fails.
      reservedNodeId: undefined,
      state: offline ? 'offline' : 'failed',
      error: offline ? undefined : filesErrorMessage(error, item.name),
      attempts: item.attempts + 1,
    })
    await persist(item.namespace)
    if (offline) return
    useFilesToasts.getState().show({ message: `Couldn’t upload “${item.name}”: ${filesErrorMessage(error, item.name)}`, tone: 'error' })
  }
}

/** Queues files for upload into a folder; returns once they are staged. */
export async function enqueueUploads(namespace: string, parentId: string | null, uploads: LocalUpload[], client: QueryClient): Promise<void> {
  queryClient = client
  const staged = await Promise.all(uploads.map(async (upload) => ({
    ...(await stage(upload)),
    id: Crypto.randomUUID(),
    namespace,
    parentId,
    state: 'waiting' as const,
    attempts: 0,
  })))
  useFileUploads.setState((state) => ({ items: [...state.items, ...staged] }))
  await persist(namespace)
  pump()
}

/** Loads the account's interrupted uploads (once) and retries any that are waiting or failed offline. */
const loaded = new Set<string>()
export async function resumeUploads(namespace: string, client: QueryClient): Promise<void> {
  queryClient = client
  if (!loaded.has(namespace)) {
    loaded.add(namespace)
    const stored = await getValue<QueuedUpload[]>(namespace, STORAGE_KEY) ?? []
    const known = new Set(useFileUploads.getState().items.map((item) => item.id))
    const restored = stored.filter((item) => !known.has(item.id) && new File(item.uri).exists)
    if (restored.length) useFileUploads.setState((state) => ({ items: [...state.items, ...restored] }))
  }
  useFileUploads.setState((state) => ({
    items: state.items.map((item) => item.namespace === namespace && item.state === 'offline' ? { ...item, state: 'waiting' } : item),
  }))
  pump()
}

export function retryUpload(id: string): void {
  update(id, { state: 'waiting', error: undefined })
  pump()
}

export async function cancelUpload(id: string): Promise<void> {
  const item = useFileUploads.getState().items.find((entry) => entry.id === id)
  if (!item || item.state === 'uploading') return
  remove(id)
  discardStaged(item.uri)
  if (item.reservedNodeId) await deleteFileNode(item.reservedNodeId).catch(() => undefined)
  await persist(item.namespace)
}

/** Forgets an account's queue (sign-out). */
export async function clearUploads(namespace: string): Promise<void> {
  const items = useFileUploads.getState().items.filter((item) => item.namespace === namespace)
  useFileUploads.setState((state) => ({ items: state.items.filter((item) => item.namespace !== namespace) }))
  for (const item of items) discardStaged(item.uri)
  loaded.delete(namespace)
}

function photoName(asset: ImagePicker.ImagePickerAsset, index: number): string {
  if (asset.fileName) return asset.fileName
  const extension = asset.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  return `Photo ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${index ? ` ${index + 1}` : ''}.${extension}`
}

/** Lets the user pick what to upload; resolves empty when they cancel. */
export async function pickUploads(source: 'photos' | 'camera' | 'files'): Promise<LocalUpload[]> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true, type: '*/*' })
    if (result.canceled) return []
    return result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', sizeBytes: asset.size ?? new File(asset.uri).size }))
  }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) throw new Error('Allow Pulpo to use the camera in Settings to take photos.')
  }
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images', 'videos'],
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    })
  if (result.canceled) return []
  return result.assets.map((asset, index) => ({
    uri: asset.uri,
    name: photoName(asset, index),
    mimeType: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    sizeBytes: asset.fileSize ?? new File(asset.uri).size,
  }))
}
