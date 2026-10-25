// @vitest-environment node
import type { FileRecording, RecordingClip } from '@pulpo/contracts'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  files: new Set<string>(),
  stored: new Map<string, unknown>(),
  upload: vi.fn(),
  cleanups: [] as Array<(namespace: string) => Promise<void> | void>,
  ids: 0,
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => `take-${++mocks.ids}` }))
vi.mock('expo-file-system', () => {
  const path = (parts: unknown[]) => parts.map((part) => typeof part === 'string' ? part : (part as { uri: string }).uri).join('/')
  class Directory {
    uri: string
    constructor(...parts: unknown[]) { this.uri = path(parts) }
    create() {}
    get exists() { return [...mocks.files].some((file) => file.startsWith(`${this.uri}/`)) }
    delete() { for (const file of [...mocks.files]) if (file.startsWith(`${this.uri}/`)) mocks.files.delete(file) }
  }
  class File {
    uri: string
    constructor(...parts: unknown[]) { this.uri = path(parts) }
    get exists() { return mocks.files.has(this.uri) }
    delete() { mocks.files.delete(this.uri) }
    async copy(destination: File) { mocks.files.add(destination.uri) }
  }
  return { Directory, File, Paths: { document: 'documents' } }
})
vi.mock('../../../api/client', () => ({
  isNetworkError: (error: unknown) => error instanceof Error && error.message === 'offline',
  ApiError: class extends Error {},
}))
vi.mock('../../../data/database', () => ({
  getValue: async (namespace: string, key: string) => mocks.stored.get(`${namespace}|${key}`) ?? null,
  setValue: async (namespace: string, key: string, value: unknown) => { mocks.stored.set(`${namespace}|${key}`, value) },
}))
vi.mock('../../../store/accountCleanup', () => ({ registerAccountCleanup: (cleanup: (namespace: string) => void) => { mocks.cleanups.push(cleanup) } }))
vi.mock('../api', () => ({ uploadRecordingClip: mocks.upload }))
vi.mock('../queries', () => ({
  filesQueryKeys: {
    all: (namespace: string) => ['files', namespace],
    recording: (namespace: string, id: string) => ['files', namespace, 'recording', id.toLowerCase()],
  },
}))

const { discardTake, keepTake, resumeTakes, retryTake, usePendingTakes } = await import('./takes')
const { filesQueryKeys } = await import('../queries')

const recordingId = '22222222-2222-4222-8222-222222222222'
const clip = (id: string) => ({ id, position: 0 }) as unknown as RecordingClip
const take = (uri: string, recordedAt: string) => ({ uri, durationMs: 2_000, levels: [10, 20], recordedAt })
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('unsent takes', () => {
  let client: QueryClient
  beforeEach(() => {
    mocks.files.clear()
    mocks.stored.clear()
    mocks.upload.mockReset()
    usePendingTakes.setState({ takes: [] })
    client = new QueryClient()
    client.setQueryData<FileRecording>(filesQueryKeys.recording('ns', recordingId), { node: { id: recordingId } as FileRecording['node'], clips: [] })
  })
  afterEach(() => { client.clear() })

  it('keeps a finished take on the device, sends it, and shows it once saved', async () => {
    mocks.files.add('file:///cache/take.m4a')
    mocks.upload.mockResolvedValueOnce(clip('clip-1'))
    const pending = await keepTake('ns', recordingId, take('file:///cache/take.m4a', '2026-10-25T14:00:00.000Z'), client)
    expect(pending.uri).toBe('documents/pending-takes/ns/take-1.m4a')
    expect(mocks.files.has('file:///cache/take.m4a')).toBe(false)
    await settle()
    expect(mocks.upload).toHaveBeenCalledWith(recordingId, expect.objectContaining({ uri: pending.uri, durationMs: 2_000, levels: [10, 20] }))
    expect(usePendingTakes.getState().takes).toEqual([])
    expect(mocks.files.has(pending.uri)).toBe(false)
    expect(client.getQueryData<FileRecording>(filesQueryKeys.recording('ns', recordingId))?.clips.map((item) => item.id)).toEqual(['clip-1'])
  })

  it('sends a recording’s takes in the order they were recorded, holding later ones behind a refused one', async () => {
    let release!: () => void
    mocks.upload
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { release = () => reject(new Error('The take couldn’t be read as audio')) }))
      .mockResolvedValue(clip('clip-2'))
    mocks.files.add('file:///a.m4a')
    mocks.files.add('file:///b.m4a')
    await keepTake('ns', recordingId, take('file:///a.m4a', '2026-10-25T14:00:00.000Z'), client)
    await keepTake('ns', recordingId, take('file:///b.m4a', '2026-10-25T14:05:00.000Z'), client)
    expect(usePendingTakes.getState().takes.map((item) => item.state)).toEqual(['uploading', 'waiting'])
    release()
    await settle()
    expect(usePendingTakes.getState().takes.map((item) => [item.state, item.error])).toEqual([['failed', 'The take couldn’t be read as audio'], ['waiting', undefined]])
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    // Discarding the refused take lets the next one go.
    await discardTake(usePendingTakes.getState().takes[0]!.id)
    await settle()
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(usePendingTakes.getState().takes).toEqual([])
  })

  it('waits for a connection, keeping the take through a restart, and tries again', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('offline'))
    mocks.files.add('file:///a.m4a')
    const pending = await keepTake('ns', recordingId, take('file:///a.m4a', '2026-10-25T14:00:00.000Z'), client)
    await settle()
    expect(usePendingTakes.getState().takes[0]).toMatchObject({ state: 'offline', error: 'Waiting for a connection' })
    expect(mocks.stored.get('ns|files:recording-takes')).toEqual([expect.objectContaining({ id: pending.id, state: 'waiting' })])

    // The app ends; the next launch finds the take on disk and sends it.
    usePendingTakes.setState({ takes: [] })
    mocks.upload.mockResolvedValueOnce(clip('clip-1'))
    await resumeTakes('ns', client)
    await settle()
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(usePendingTakes.getState().takes).toEqual([])
  })

  it('tries a refused take again by hand', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce(clip('clip-1'))
    mocks.files.add('file:///a.m4a')
    const pending = await keepTake('ns', recordingId, take('file:///a.m4a', '2026-10-25T14:00:00.000Z'), client)
    await settle()
    expect(usePendingTakes.getState().takes[0]?.state).toBe('failed')
    retryTake(pending.id)
    await settle()
    expect(usePendingTakes.getState().takes).toEqual([])
  })

  it('forgets an account’s unsent takes when it signs out', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('offline'))
    mocks.files.add('file:///a.m4a')
    const pending = await keepTake('ns', recordingId, take('file:///a.m4a', '2026-10-25T14:00:00.000Z'), client)
    await settle()
    for (const cleanup of mocks.cleanups) await cleanup('ns')
    expect(usePendingTakes.getState().takes).toEqual([])
    expect(mocks.files.has(pending.uri)).toBe(false)
  })
})
