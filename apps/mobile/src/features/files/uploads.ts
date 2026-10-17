import type { FileNode } from '@pulpo/contracts'
import type { QueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { create } from 'zustand'
import { isNetworkError } from '../../api/client'
import { cacheNamespace, getValue, setValue } from '../../data/database'
import { useSessionStore } from '../../store/session'
import { cacheUploadedFile, deleteFileNode, fetchFileNode, uploadFile, type LocalUpload } from './api'
import { filesCapability, isFilesDisabledError } from './availability'
import { filesErrorMessage } from './display'
import { refreshFiles } from './operations'
import { useFilesToasts } from './toasts'

/**
 * Files uploads. Picked files are copied into the app's own storage and recorded first, so an
 * upload interrupted by going offline, backgrounding, or the app ending resumes on the next
 * launch. A resumed upload first settles the reservation its interrupted attempt left behind.
 */
export interface QueuedUpload extends LocalUpload {
  id: string
  namespace: string
  parentId: string | null
  /** The placeholder the server made for the attempt in progress, settled before it is retried. */
  reservedNodeId?: string
  /** `offline`: waiting for a connection; `resumeUploads` (on reconnect or launch) retries it. */
  state: 'waiting' | 'uploading' | 'offline' | 'failed'
  error?: string
  attempts: number
  /** System transfers that failed since the upload was queued or last tried again by hand. */
  transferFailures?: number
}

const STORAGE_KEY = 'files:uploads'
const CONCURRENCY = 3
/**
 * Failed system transfers after which one is reported instead of waiting for a connection: a
 * transfer can also fail for good (e.g. the device has no room to send it from).
 */
const MAX_TRANSFER_FAILURES = 3
/** A failed transfer is tried again after this even if the connection never seemed to drop. */
const TRANSFER_RETRY_MS = 30_000

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

/** Where an account's picked files wait to be uploaded, each in a directory of its own. */
function pendingDirectory(namespace: string): Directory {
  return new Directory(Paths.document, 'pending-uploads', encodeURIComponent(namespace))
}

/** Directories being staged into, which are not in the queue yet. */
const staging = new Set<string>()

/** Copies a picked file somewhere it survives the picker's temporary files being cleared. */
async function stage(namespace: string, source: LocalUpload): Promise<LocalUpload> {
  const directory = new Directory(pendingDirectory(namespace), Crypto.randomUUID())
  staging.add(directory.uri)
  try {
    directory.create({ idempotent: true, intermediates: true })
    const destination = new File(directory, source.name.replace(/[\\/]/g, '-') || 'file')
    await new File(source.uri).copy(destination)
    return { ...source, uri: destination.uri, sizeBytes: destination.size || source.sizeBytes }
  } catch (error) {
    staging.delete(directory.uri)
    try {
      if (directory.exists) directory.delete()
    } catch {
      // Swept on the next launch.
    }
    throw error
  }
}

function stagedDirectory(uri: string): string {
  return new File(uri).parentDirectory.uri
}

/**
 * Removes staged copies the account's queue no longer knows, e.g. one left by the app ending
 * between finishing an upload and deleting its copy.
 */
function sweepStaged(namespace: string, stored: readonly QueuedUpload[]): void {
  try {
    const directory = pendingDirectory(namespace)
    if (!directory.exists) return
    const known = new Set([...useFileUploads.getState().items.filter((item) => item.namespace === namespace), ...stored].map((item) => stagedDirectory(item.uri)))
    for (const entry of directory.list()) {
      if (!known.has(entry.uri) && !staging.has(entry.uri)) entry.delete()
    }
  } catch {
    // Tried again on the next launch.
  }
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
let transferRetry: { namespace: string; timer: ReturnType<typeof setTimeout> } | undefined

function retryTransfersSoon(namespace: string): void {
  if (transferRetry) return
  transferRetry = {
    namespace,
    timer: setTimeout(() => {
      transferRetry = undefined
      if (queryClient) void resumeUploads(namespace, queryClient).catch(() => undefined)
    }, TRANSFER_RETRY_MS),
  }
}

/** The signed-in account's namespace; uploads only run for it, with its session. */
function activeNamespace(): string | null {
  const { instanceUrl, user } = useSessionStore.getState()
  return user ? cacheNamespace(instanceUrl, user.id) : null
}

class AccountChangedError extends Error {
  constructor() {
    super('The account changed')
  }
}

/** Files is known to be off. An unknown configuration (not read yet) lets uploads try. */
function filesTurnedOff(): boolean {
  const { config } = useSessionStore.getState()
  return Boolean(config) && !filesCapability(config).enabled
}

function pump(): void {
  // While an administrator has Files off, uploads wait; they resume once it is back on.
  if (filesTurnedOff()) return
  while (running < CONCURRENCY) {
    const namespace = activeNamespace()
    // Another account's uploads wait until it is signed in again.
    const next = useFileUploads.getState().items.find((item) => item.state === 'waiting' && item.namespace === namespace)
    if (!next) return
    running += 1
    update(next.id, { state: 'uploading', error: undefined })
    void runUpload(next).finally(() => {
      running -= 1
      pump()
    })
  }
}

const statusOf = (error: unknown) => (error as { status?: number } | null)?.status

/**
 * What became of an earlier attempt's placeholder. If its confirmation went through but the answer
 * was lost, the file is there: the upload is done, and the file is left alone even if it has been
 * trashed since. A placeholder still waiting for its bytes is released. `kept` means the server
 * could not be asked (e.g. offline), so the next attempt asks again.
 */
async function settleReservation(nodeId: string): Promise<{ uploaded: FileNode } | 'released' | 'kept'> {
  let node: FileNode
  try {
    node = (await fetchFileNode(nodeId)).node
  } catch (error) {
    return statusOf(error) === 404 ? 'released' : 'kept'
  }
  if (node.status === 'ready') return { uploaded: node }
  try {
    await deleteFileNode(nodeId)
    return 'released'
  } catch (error) {
    return statusOf(error) === 404 ? 'released' : 'kept'
  }
}

/** The upload is on the server: forget it first, so ending the app now cannot upload it again. */
async function complete(item: QueuedUpload, node: FileNode): Promise<void> {
  remove(item.id)
  await persist(item.namespace)
  await cacheUploadedFile(item.namespace, node, item.uri).catch(() => undefined)
  discardStaged(item.uri)
  if (queryClient) await refreshFiles(queryClient, item.namespace)
}

async function runUpload(item: QueuedUpload): Promise<void> {
  const assertActive = () => { if (activeNamespace() !== item.namespace) throw new AccountChangedError() }
  let reservedNodeId = item.reservedNodeId
  try {
    assertActive()
    // An earlier attempt's placeholder would otherwise take the name and wait 24 hours to be purged,
    // unless that attempt in fact finished.
    if (reservedNodeId) {
      const earlier = await settleReservation(reservedNodeId)
      if (earlier === 'kept') throw Object.assign(new Error('The earlier attempt could not be checked'), { retry: true })
      if (earlier !== 'released') {
        await complete(item, earlier.uploaded)
        return
      }
      reservedNodeId = undefined
      update(item.id, { reservedNodeId: undefined })
    }
    const node = await uploadFile(item.parentId, item, {
      assertActive,
      onReserved: (reserved) => {
        reservedNodeId = reserved.id
        update(item.id, { reservedNodeId: reserved.id })
        void persist(item.namespace)
        if (queryClient) void refreshFiles(queryClient, item.namespace)
      },
    })
    await complete(item, node)
  } catch (error) {
    if (error instanceof AccountChangedError || activeNamespace() !== item.namespace) {
      // The placeholder belongs to the other account; it is released when that account resumes.
      update(item.id, { state: 'waiting', reservedNodeId })
      await persist(item.namespace)
      return
    }
    // Forget the placeholder only once it is released; the next attempt settles it otherwise.
    if (reservedNodeId) {
      const earlier = await settleReservation(reservedNodeId)
      if (earlier === 'released') reservedNodeId = undefined
      else if (earlier !== 'kept') {
        await complete(item, earlier.uploaded)
        return
      }
    }
    // Files turned off meanwhile: the upload waits for it to be back on, like it waits for a connection.
    const { retry, transfer } = (error ?? {}) as { retry?: boolean; transfer?: boolean }
    const transferFailures = (item.transferFailures ?? 0) + (transfer === true ? 1 : 0)
    const offline = (isNetworkError(error) || retry === true || isFilesDisabledError(error))
      && !(transfer === true && transferFailures >= MAX_TRANSFER_FAILURES)
    update(item.id, {
      reservedNodeId,
      state: offline ? 'offline' : 'failed',
      error: offline ? undefined : filesErrorMessage(error, item.name),
      attempts: item.attempts + 1,
      transferFailures,
    })
    await persist(item.namespace)
    if (queryClient) void refreshFiles(queryClient, item.namespace)
    // Reconnecting retries it too, but the socket may well have stayed up through the failure.
    if (offline && transfer === true) retryTransfersSoon(item.namespace)
    if (offline) return
    useFilesToasts.getState().show({ message: `Couldn’t upload “${item.name}”: ${filesErrorMessage(error, item.name)}`, tone: 'error' })
  }
}

/** Queues files for upload into a folder; returns once they are staged. */
export async function enqueueUploads(namespace: string, parentId: string | null, uploads: LocalUpload[], client: QueryClient): Promise<void> {
  queryClient = client
  const copies = await Promise.allSettled(uploads.map((upload) => stage(namespace, upload)))
  const failed = copies.find((copy) => copy.status === 'rejected')
  if (failed) {
    // Nothing is queued unless every file is: the copies already made go.
    for (const copy of copies) {
      if (copy.status === 'fulfilled') {
        staging.delete(stagedDirectory(copy.value.uri))
        discardStaged(copy.value.uri)
      }
    }
    throw failed.reason
  }
  const staged = copies.map((copy) => ({
    ...(copy as PromiseFulfilledResult<LocalUpload>).value,
    id: Crypto.randomUUID(),
    namespace,
    parentId,
    state: 'waiting' as const,
    attempts: 0,
  }))
  useFileUploads.setState((state) => ({ items: [...state.items, ...staged] }))
  for (const item of staged) staging.delete(stagedDirectory(item.uri))
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
    sweepStaged(namespace, stored)
  }
  useFileUploads.setState((state) => ({
    items: state.items.map((item) => item.namespace === namespace && item.state === 'offline' ? { ...item, state: 'waiting' } : item),
  }))
  pump()
}

/** Whether an upload has stopped, so it can be tried again or removed (not while it runs). */
function stopped(item: QueuedUpload | undefined): item is QueuedUpload {
  return item?.state === 'failed' || item?.state === 'offline'
}

export function retryUpload(id: string): void {
  // The upload may have resumed on its own while the user decided, e.g. on reconnecting.
  if (!stopped(useFileUploads.getState().items.find((item) => item.id === id))) return
  update(id, { state: 'waiting', error: undefined, transferFailures: 0 })
  pump()
}

export async function cancelUpload(id: string): Promise<void> {
  const item = useFileUploads.getState().items.find((entry) => entry.id === id)
  if (!stopped(item)) return
  remove(id)
  discardStaged(item.uri)
  // Only a placeholder still waiting for its bytes is deleted; a finished upload stays.
  if (item.reservedNodeId) await settleReservation(item.reservedNodeId)
  await persist(item.namespace)
}

/** Forgets an account's queue (sign-out), including uploads staged while it was not active. */
export async function clearUploads(namespace: string): Promise<void> {
  if (transferRetry?.namespace === namespace) {
    clearTimeout(transferRetry.timer)
    transferRetry = undefined
  }
  const inMemory = useFileUploads.getState().items.filter((item) => item.namespace === namespace)
  useFileUploads.setState((state) => ({ items: state.items.filter((item) => item.namespace !== namespace) }))
  const stored = await getValue<QueuedUpload[]>(namespace, STORAGE_KEY).catch(() => null) ?? []
  for (const uri of new Set([...inMemory, ...stored].map((item) => item.uri))) discardStaged(uri)
  try {
    const directory = pendingDirectory(namespace)
    if (directory.exists) directory.delete()
  } catch {
    // Already gone.
  }
  await setValue(namespace, STORAGE_KEY, []).catch(() => undefined)
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
