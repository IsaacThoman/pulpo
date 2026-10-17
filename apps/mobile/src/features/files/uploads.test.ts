// @vitest-environment node
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const kv = new Map<string, unknown>()
  return {
    kv,
    session: { instanceUrl: 'https://pulpo.test', user: { id: 'a' } as { id: string } | null },
    uploadFile: vi.fn(),
    deleteFileNode: vi.fn(async (_id: string) => undefined),
    fetchFileNode: vi.fn(async (_id: string): Promise<{ node: Record<string, unknown> }> => ({ node: { id: _id, status: 'pending' } })),
    cacheUploadedFile: vi.fn(async () => undefined),
    deleted: [] as string[],
    events: [] as string[],
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
    delete() {}
  }
  class File {
    uri: string
    exists = true
    size = 10
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/') }
    get parentDirectory() { return new Directory(this.uri.split('/').slice(0, -1).join('/')) }
    async copy(destination: File) { mocks.events.push(`copy ${destination.uri}`) }
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
vi.mock('./toasts', () => ({ useFilesToasts: { getState: () => ({ show: () => {} }) } }))

const { clearUploads, enqueueUploads, resumeUploads, useFileUploads } = await import('./uploads')

const A = 'https://pulpo.test|a'
const B = 'https://pulpo.test|b'
const client = {} as QueryClient
const photo = (name: string) => ({ uri: `cache/${name}`, name, mimeType: 'image/jpeg', sizeBytes: 10 })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mocks.kv.clear()
  mocks.session.user = { id: 'a' }
  mocks.uploadFile.mockReset()
  mocks.deleteFileNode.mockReset().mockImplementation(async () => undefined)
  mocks.fetchFileNode.mockReset().mockImplementation(async (id: string) => ({ node: { id, status: 'pending' } }))
  mocks.cacheUploadedFile.mockReset().mockImplementation(async () => undefined)
  mocks.deleted.length = 0
  mocks.events.length = 0
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
    expect(mocks.cacheUploadedFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'placeholder-4' }), expect.any(String))
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
})
