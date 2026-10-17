// @vitest-environment node
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const kv = new Map<string, unknown>()
  return {
    kv,
    session: { instanceUrl: 'https://pulpo.test', user: { id: 'a' } as { id: string } | null, config: {} as object | null },
    uploadFile: vi.fn(),
    deleteFileNode: vi.fn(async (_id: string) => undefined),
    fetchFileNode: vi.fn(async (_id: string): Promise<{ node: Record<string, unknown> }> => ({ node: { id: _id, status: 'pending' } })),
    cacheUploadedFile: vi.fn(async () => undefined),
    deleted: [] as string[],
    events: [] as string[],
    toasts: [] as string[],
    filesEnabled: true,
    /** Picked files that cannot be copied. */
    unreadable: new Set<string>(),
    /** What each directory holds, by its URI. */
    listing: new Map<string, string[]>(),
  }
})

vi.mock('expo-crypto', () => {
  let next = 0
  return { randomUUID: () => `id-${next++}` }
})
vi.mock('expo-document-picker', () => ({}))
vi.mock('expo-image-picker', () => ({}))
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string
    exists = true
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/') }
    create() {}
    delete() { mocks.deleted.push(this.uri) }
    list() { return (mocks.listing.get(this.uri) ?? []).map((uri) => new Directory(uri)) }
  }
  class File {
    uri: string
    exists = true
    size = 10
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/') }
    get parentDirectory() { return new Directory(this.uri.split('/').slice(0, -1).join('/')) }
    async copy(destination: File) {
      if (mocks.unreadable.has(this.uri)) throw new Error('unreadable')
      mocks.events.push(`copy ${destination.uri}`)
    }
    delete() { mocks.deleted.push(this.uri) }
  }
  return { Directory, File, Paths: { document: 'documents' } }
})
vi.mock('../../data/database', () => ({
  cacheNamespace: (instanceUrl: string, userId: string) => `${instanceUrl}|${userId}`,
  getValue: async (namespace: string, key: string) => mocks.kv.get(`${namespace}:${key}`) ?? null,
  setValue: async (namespace: string, key: string, value: unknown) => { mocks.kv.set(`${namespace}:${key}`, structuredClone(value)) },
}))
vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => mocks.session } }))
vi.mock('../../api/client', () => ({ isNetworkError: (error: unknown) => (error as { network?: boolean })?.network === true }))
vi.mock('./api', () => ({ uploadFile: mocks.uploadFile, deleteFileNode: mocks.deleteFileNode, fetchFileNode: mocks.fetchFileNode, cacheUploadedFile: mocks.cacheUploadedFile }))
vi.mock('./operations', () => ({ refreshFiles: async () => undefined }))
vi.mock('./display', () => ({ filesErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)) }))
vi.mock('./toasts', () => ({ useFilesToasts: { getState: () => ({ show: ({ message }: { message: string }) => { mocks.toasts.push(message) } }) } }))
vi.mock('./availability', () => ({
  filesCapability: () => ({ enabled: mocks.filesEnabled, docSchemaVersion: null }),
  isFilesDisabledError: (error: unknown) => (error as { code?: string } | null)?.code === 'files_disabled',
}))

const { cancelUpload, clearUploads, enqueueUploads, resumeUploads, retryUpload, useFileUploads } = await import('./uploads')

const A = 'https://pulpo.test|a'
const B = 'https://pulpo.test|b'
const client = {} as QueryClient
const photo = (name: string) => ({ uri: `cache/${name}`, name, mimeType: 'image/jpeg', sizeBytes: 10 })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mocks.kv.clear()
  mocks.session.user = { id: 'a' }
  mocks.session.config = {}
  mocks.uploadFile.mockReset()
  mocks.deleteFileNode.mockReset().mockImplementation(async () => undefined)
  mocks.fetchFileNode.mockReset().mockImplementation(async (id: string) => ({ node: { id, status: 'pending' } }))
  mocks.cacheUploadedFile.mockReset().mockImplementation(async () => undefined)
  mocks.deleted.length = 0
  mocks.events.length = 0
  mocks.toasts.length = 0
  mocks.filesEnabled = true
  mocks.unreadable.clear()
  mocks.listing.clear()
  useFileUploads.setState({ items: [] })
})

describe('Files uploads', () => {
  it('uploads into the account that queued them, never another one signed in later', async () => {
    let finish!: () => void
    mocks.uploadFile.mockImplementation(async (_parent: string | null, upload: { name: string }, options: { assertActive: () => void }) => {
      await new Promise<void>((resolve) => { finish = resolve })
      options.assertActive()
      return { id: `node-${upload.name}`, name: upload.name }
    })
    await enqueueUploads(A, null, [photo('one.jpg')], client)
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'uploading', namespace: A })
    mocks.session.user = { id: 'b' }
    finish()
    await settle()
    // The upload stopped when the account changed, and waits for its account.
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'waiting', namespace: A })
    await resumeUploads(B, client)
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed attempt\'s placeholder only once it is released, and releases it before retrying', async () => {
    mocks.uploadFile.mockImplementationOnce(async (_parent: string | null, _upload: unknown, options: { onReserved: (node: { id: string }) => void }) => {
      options.onReserved({ id: 'placeholder-1' })
      throw Object.assign(new Error('offline'), { network: true })
    })
    mocks.fetchFileNode.mockImplementationOnce(async () => { throw Object.assign(new Error('offline'), { network: true }) })
    await enqueueUploads(A, null, [photo('two.jpg')], client)
    await settle()
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'offline', reservedNodeId: 'placeholder-1' })

    mocks.uploadFile.mockImplementationOnce(async () => ({ id: 'node-2', name: 'two.jpg' }))
    await resumeUploads(A, client)
    await settle()
    expect(mocks.deleteFileNode).toHaveBeenLastCalledWith('placeholder-1')
    expect(useFileUploads.getState().items).toEqual([])
  })

  it('finishes an upload whose confirmation answer was lost, instead of uploading it again', async () => {
    mocks.uploadFile.mockImplementationOnce(async (_parent: string | null, _upload: unknown, options: { onReserved: (node: { id: string }) => void }) => {
      options.onReserved({ id: 'placeholder-4' })
      // The server confirmed the file, but the answer never arrived.
      throw Object.assign(new Error('timed out'), { network: true })
    })
    mocks.fetchFileNode.mockImplementation(async (id: string) => ({ node: { id, name: 'four.jpg', status: 'ready' } }))
    await enqueueUploads(A, null, [photo('four.jpg')], client)
    await settle()
    expect(useFileUploads.getState().items).toEqual([])
    expect(mocks.deleteFileNode).not.toHaveBeenCalled()
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    expect(mocks.cacheUploadedFile).toHaveBeenCalledWith(A, expect.objectContaining({ id: 'placeholder-4' }), expect.any(String))
  })

  it('never deletes a finished earlier attempt, even one trashed since, when resuming', async () => {
    // As after a relaunch: the queue is read from storage.
    await clearUploads(A)
    mocks.kv.set(`${A}:files:uploads`, [{ id: 'old', namespace: A, parentId: null, uri: 'documents/pending-uploads/x/five.jpg', name: 'five.jpg', mimeType: 'image/jpeg', sizeBytes: 10, state: 'waiting', attempts: 1, reservedNodeId: 'placeholder-5' }])
    mocks.fetchFileNode.mockImplementation(async (id: string) => ({ node: { id, name: 'five.jpg', status: 'ready', trashedAt: '2026-10-17T00:00:00.000Z' } }))
    await resumeUploads(A, client)
    await settle()
    expect(mocks.fetchFileNode).toHaveBeenCalledWith('placeholder-5')
    expect(mocks.deleteFileNode).not.toHaveBeenCalled()
    expect(mocks.uploadFile).not.toHaveBeenCalled()
    expect(useFileUploads.getState().items).toEqual([])
  })

  it('forgets a finished upload before keeping its copy, so ending the app cannot upload it twice', async () => {
    mocks.uploadFile.mockImplementation(async () => ({ id: 'node-3', name: 'three.jpg' }))
    mocks.cacheUploadedFile.mockImplementation(async () => {
      mocks.events.push(`cached; queue: ${JSON.stringify(mocks.kv.get(`${A}:files:uploads`))}`)
    })
    await enqueueUploads(A, null, [photo('three.jpg')], client)
    await settle()
    expect(mocks.events.at(-1)).toBe('cached; queue: []')
  })

  it('removes the staged files of an account signed out while another was active', async () => {
    mocks.uploadFile.mockImplementation(() => new Promise(() => {}))
    mocks.session.user = { id: 'b' }
    // A's queue as stored on the device, never loaded while B is active.
    mocks.kv.set(`${A}:files:uploads`, [{ id: 'old', namespace: A, parentId: null, uri: 'documents/pending-uploads/x/old.jpg', name: 'old.jpg', mimeType: 'image/jpeg', sizeBytes: 10, state: 'waiting', attempts: 0 }])
    await clearUploads(A)
    expect(mocks.deleted).toContain('documents/pending-uploads/x/old.jpg')
    expect(mocks.kv.get(`${A}:files:uploads`)).toEqual([])
  })
  it('keeps an upload that resumed on its own while the user chose Try Again or Remove', async () => {
    mocks.uploadFile.mockImplementationOnce(async () => { throw Object.assign(new Error('offline'), { network: true }) })
    await enqueueUploads(A, null, [photo('six.jpg')], client)
    await settle()
    const id = useFileUploads.getState().items[0]!.id
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'offline' })
    // Reconnecting resumes it while the alert is still open.
    mocks.uploadFile.mockImplementation(() => new Promise(() => {}))
    await resumeUploads(A, client)
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'uploading' })
    retryUpload(id)
    await cancelUpload(id)
    expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
    expect(useFileUploads.getState().items[0]).toMatchObject({ id, state: 'uploading' })
  })

  it('waits while Files is turned off, without failing, and goes on once it is back on', async () => {
    mocks.filesEnabled = false
    await enqueueUploads(A, null, [photo('seven.jpg')], client)
    expect(mocks.uploadFile).not.toHaveBeenCalled()
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'waiting' })

    // Turned off while uploading: the upload waits, with nothing to report.
    mocks.filesEnabled = true
    mocks.uploadFile.mockImplementationOnce(async () => { throw Object.assign(new Error('Files are disabled'), { code: 'files_disabled' }) })
    await resumeUploads(A, client)
    await settle()
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'offline' })
    expect(mocks.toasts).toEqual([])

    mocks.uploadFile.mockImplementationOnce(async () => ({ id: 'node-7', name: 'seven.jpg' }))
    await resumeUploads(A, client)
    await settle()
    expect(useFileUploads.getState().items).toEqual([])
  })

  it('queues nothing, and keeps no copies, when one of the picked files cannot be copied', async () => {
    mocks.unreadable.add('cache/bad.jpg')
    await expect(enqueueUploads(A, null, [photo('good.jpg'), photo('bad.jpg')], client)).rejects.toThrow('unreadable')
    expect(useFileUploads.getState().items).toEqual([])
    expect(mocks.uploadFile).not.toHaveBeenCalled()
    const copied = mocks.events.find((event) => event.endsWith('/good.jpg'))!.slice('copy '.length)
    expect(mocks.deleted).toContain(copied)
    expect(mocks.deleted.some((uri) => uri.endsWith('/bad.jpg') || copied.startsWith(`${uri}/`))).toBe(true)
  })

  it('removes staged copies its queue no longer knows when it first resumes', async () => {
    await clearUploads(A)
    const directory = `documents/pending-uploads/${encodeURIComponent(A)}`
    mocks.listing.set(directory, [`${directory}/queued`, `${directory}/left-behind`])
    mocks.kv.set(`${A}:files:uploads`, [{ id: 'queued', namespace: A, parentId: null, uri: `${directory}/queued/eight.jpg`, name: 'eight.jpg', mimeType: 'image/jpeg', sizeBytes: 10, state: 'failed', attempts: 1, error: 'Too large' }])
    mocks.deleted.length = 0
    await resumeUploads(A, client)
    expect(mocks.deleted).toEqual([`${directory}/left-behind`])
    expect(useFileUploads.getState().items).toMatchObject([{ id: 'queued' }])
  })

  it('uploads what was queued before an offline launch, before the configuration is read', async () => {
    await clearUploads(A)
    // Launched offline: nothing says what the instance offers yet (Files would read as off).
    mocks.session.config = null
    mocks.filesEnabled = false
    mocks.kv.set(`${A}:files:uploads`, [{ id: 'queued', namespace: A, parentId: null, uri: 'documents/pending-uploads/x/nine.jpg', name: 'nine.jpg', mimeType: 'image/jpeg', sizeBytes: 10, state: 'waiting', attempts: 0 }])
    mocks.uploadFile.mockImplementation(async () => ({ id: 'node-9', name: 'nine.jpg' }))
    await resumeUploads(A, client)
    await settle()
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    expect(useFileUploads.getState().items).toEqual([])
  })

  it('reports a system transfer that keeps failing instead of waiting for a connection forever', async () => {
    mocks.uploadFile.mockImplementation(async () => { throw Object.assign(new Error('Unable to upload a file: no space left'), { retry: true, transfer: true }) })
    await enqueueUploads(A, null, [photo('ten.jpg')], client)
    await settle()
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'offline', attempts: 1 })
    await resumeUploads(A, client)
    await settle()
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'offline', attempts: 2 })
    await resumeUploads(A, client)
    await settle()
    expect(useFileUploads.getState().items[0]).toMatchObject({ state: 'failed', attempts: 3, error: 'Unable to upload a file: no space left' })
    expect(mocks.toasts).toHaveLength(1)
  })
})
