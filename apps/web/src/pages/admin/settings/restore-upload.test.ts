import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { discardRestoreBackup, uploadRestoreBackup, uploadRestoreChunk, type RestoreUploadSession } from './restore-upload'

const context = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest: context.request }))
vi.mock('@/lib/runtime', () => ({
  isDesktopRuntime: () => false, runtimeInstanceUrl: () => 'https://dev.example.test',
  runtimeApiUrl: (path: string) => path, runtimeAuthorizationHeaders: () => ({}),
}))

let session: RestoreUploadSession
const checksum = async (body: Blob) => createHash('sha256').update(Buffer.from(await body.arrayBuffer())).digest('hex')
const file = () => new File(['abcdefghijklmnopqrstuvwx'], 'backup.tar.gz', { lastModified: 1 })
const options = () => ({ signal: new AbortController().signal, onProgress: vi.fn(), onSession: vi.fn(), onFinalizing: vi.fn() })

beforeEach(() => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) })
  session = { id: '', chunkSize: 8, status: 'uploading', parts: {}, job: null }
  context.request.mockReset().mockImplementation(async (path: string, init?: { body?: { id?: string } }) => {
    if (path.endsWith('/uploads')) { session.id = init!.body!.id!; return structuredClone(session) }
    if (path.endsWith('/complete')) { session.status = 'queued'; return { id: session.id } }
    return undefined
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('resumable browser restore uploads', () => {
  it('sends at most two chunks concurrently, verifies bytes, and finalizes once', async () => {
    let active = 0, maximum = 0
    const transport = vi.fn(async (_path: string, part: Blob, hash: string) => {
      maximum = Math.max(maximum, ++active)
      expect(hash).toBe(await checksum(part))
      await new Promise((resolve) => setTimeout(resolve, 5)); active--
    })
    const callbacks = options()
    await uploadRestoreBackup(file(), 'admin', callbacks, transport)
    expect(maximum).toBe(2); expect(transport).toHaveBeenCalledTimes(3)
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(file().size)
    expect(context.request.mock.calls.filter(([path]) => path.endsWith('/complete'))).toHaveLength(1)
  })
  it('resumes an existing session and hashes acknowledged chunks before skipping them', async () => {
    const backup = file(), transport = vi.fn(async () => undefined)
    session.parts[0] = { size: 8, checksum: await checksum(backup.slice(0, 8)) }
    await uploadRestoreBackup(backup, 'admin', options(), transport)
    expect(transport).toHaveBeenCalledTimes(2)
    // Concurrent chunks can finish hashing and reach the transport in either order.
    expect(transport.mock.calls.map((call) => (call as unknown as string[])[0]).sort()).toEqual([
      `/api/admin/restore/uploads/${session.id}/parts/1`, `/api/admin/restore/uploads/${session.id}/parts/2`,
    ])
    const id = session.id
    await uploadRestoreBackup(backup, 'admin', options(), transport)
    expect(session.id).toBe(id)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('rejects mismatched acknowledged data without starting a restore', async () => {
    session.parts[0] = { size: 8, checksum: '0'.repeat(64) }
    await expect(uploadRestoreBackup(file(), 'admin', options(), vi.fn())).rejects.toThrow('differs from the interrupted upload')
    expect(context.request.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
  })
  it('retries a failed chunk without restarting successful chunks', async () => {
    const calls = new Map<string, number>()
    const transport = vi.fn(async (path: string) => {
      calls.set(path, (calls.get(path) ?? 0) + 1)
      if (path.endsWith('/0') && calls.get(path) === 1) throw new ApiError(503, 'unavailable', 'Try again')
    })
    await uploadRestoreBackup(file(), 'admin', options(), transport)
    expect([...calls.values()].sort()).toEqual([1, 1, 2])
  })
  it('aborts and waits for the sibling request after a permanent failure', async () => {
    let siblingAborted = false
    const transport = vi.fn(async (path: string, _part: Blob, _hash: string, _progress: (n: number) => void, signal: AbortSignal) => {
      if (path.endsWith('/0')) { await new Promise((resolve) => setTimeout(resolve, 10)); throw new ApiError(400, 'invalid', 'Invalid chunk') }
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => { siblingAborted = true; reject(new DOMException('Aborted', 'AbortError')) }, { once: true }))
    })
    await expect(uploadRestoreBackup(file(), 'admin', options(), transport)).rejects.toThrow('Invalid chunk')
    expect(siblingAborted).toBe(true)
    expect(context.request.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
  })
  it('starts a new session when the saved upload expired', async () => {
    const callbacks = options()
    await uploadRestoreBackup(file(), 'admin', callbacks, vi.fn())
    const oldId = session.id
    session.status = 'uploading'
    context.request.mockRejectedValueOnce(new ApiError(410, 'expired', 'Expired'))
    await uploadRestoreBackup(file(), 'admin', callbacks, vi.fn())
    expect(session.id).not.toBe(oldId)
  })
  it('rejects encrypted files before creating a session', async () => {
    await expect(uploadRestoreBackup(new File(['age-encryption.org/v1\nsecret'], 'backup.tar.gz.age'), 'admin', options(), vi.fn())).rejects.toThrow('Decrypt')
    expect(context.request).not.toHaveBeenCalled()
  })
  it('discards the server session and forgets its browser resume identifier', async () => {
    await uploadRestoreBackup(file(), 'admin', options(), vi.fn())
    const oldId = session.id
    await discardRestoreBackup(oldId, file(), 'admin')
    session.status = 'uploading'
    await uploadRestoreBackup(file(), 'admin', options(), vi.fn())
    expect(session.id).not.toBe(oldId)
  })
  it('shows a useful error for an HTML 413 response', async () => {
    class Xhr {
      status = 413; responseText = '<html>Too large</html>'; upload = {}; onload?: () => void
      open() {} setRequestHeader() {} abort() {}
      send() { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('XMLHttpRequest', Xhr)
    await expect(uploadRestoreChunk('/upload', new Blob(['a']), 'hash', vi.fn(), new AbortController().signal)).rejects.toThrow('too large')
  })
})
