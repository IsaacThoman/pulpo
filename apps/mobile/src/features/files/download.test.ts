// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_SCHEMA } from '../../data/schema'

const mocks = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  files: new Map<string, string>(),
  userId: 'owner',
  offline: false,
  content: 'original',
  nextNode: null as FileNode | null,
  request: vi.fn(),
  download: vi.fn(),
  copyFails: false,
}))

vi.mock('expo-file-system', () => {
  class Directory {
    uri: string
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/') }
    create() {}
  }
  class File extends Directory {
    get exists() { return mocks.files.has(this.uri) }
    get size() { return mocks.files.get(this.uri)?.length ?? 0 }
    delete() { mocks.files.delete(this.uri) }
    async copy(destination: File) {
      if (mocks.copyFails) throw new Error('disk is full')
      mocks.files.set(destination.uri, mocks.files.get(this.uri)!)
    }
    static async downloadFileAsync(url: string, destination: File) {
      mocks.download(url)
      mocks.files.set(destination.uri, mocks.content)
      return destination
    }
  }
  return { Directory, File, Paths: { cache: 'cache' } }
})
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  apiRequest: async (path: string) => {
    mocks.request(path)
    if (mocks.offline) throw new Error('offline')
    return path.endsWith('/download') ? { url: '/content' } : mocks.nextNode
  },
  apiUrl: (path: string) => `https://pulpo.test${path}`,
  nativeAuthorizationHeaders: () => ({}),
}))
vi.mock('../../data/database', () => ({
  cacheNamespace: (instance: string, id: string) => `${instance}|${id}`,
  getValue: async () => null,
  setValue: async () => undefined,
  withMobileDatabase: async <T,>(operation: (db: unknown) => Promise<T>) => operation({
    runAsync: async (source: string, ...params: Array<string | number | null>) => mocks.database!.prepare(source).run(...params),
    getFirstAsync: async (source: string, ...params: Array<string | number | null>) => mocks.database!.prepare(source).get(...params) ?? null,
    getAllAsync: async (source: string, ...params: Array<string | number | null>) => mocks.database!.prepare(source).all(...params),
  }),
}))
vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => ({ instanceUrl: 'https://pulpo.test', user: { id: mocks.userId } }) } }))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: { getState: () => ({ attachmentCacheMb: 100 }) } }))

const { downloadFile, fileContentVersion, updateFileNode } = await import('./api')
const { renameSidebarItem } = await import('../sidebar/api')

const original: FileNode = {
  id: 'aaaabbbb-1111-2222-3333-123456789abc', parentId: null, kind: 'blob', name: 'report.txt',
  status: 'ready', mimeType: 'text/plain', sizeBytes: 8, contentChecksum: 'original-checksum',
  revision: 0, trashedAt: null, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z',
}
const changedMetadata: FileNode = { ...original, name: 'renamed.txt', revision: 1, updatedAt: '2026-10-18T00:00:01.000Z' }

beforeEach(() => {
  mocks.database = new DatabaseSync(':memory:')
  mocks.database.exec(MOBILE_SCHEMA)
  mocks.files.clear()
  mocks.userId = 'owner'
  mocks.offline = false
  mocks.content = 'original'
  mocks.nextNode = changedMetadata
  mocks.copyFails = false
  mocks.request.mockClear()
  mocks.download.mockClear()
})
afterEach(() => { mocks.database!.close() })

describe('downloaded file content', () => {
  it.each(['Files', 'Sidebar'])('remains available offline after a %s rename', async (surface) => {
    const downloaded = await downloadFile(original)
    const renamed = surface === 'Files'
      ? await updateFileNode(original.id, { name: changedMetadata.name })
      : await renameSidebarItem(original.id, changedMetadata.name)
    mocks.offline = true
    mocks.request.mockClear()
    const reopened = await downloadFile(renamed)
    expect(reopened.uri).toMatch(/\/renamed\.txt$/)
    expect(mocks.files.has(downloaded.uri)).toBe(false)
    expect(mocks.files.get(reopened.uri)).toBe('original')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })

  it('keeps opening the downloaded bytes if there is no room for their renamed copy', async () => {
    const downloaded = await downloadFile(original)
    mocks.offline = true
    mocks.copyFails = true
    const reopened = await downloadFile(changedMetadata)
    expect(reopened.uri).toBe(downloaded.uri)
    expect(mocks.files.get(reopened.uri)).toBe('original')
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })

  it('keeps the downloaded bytes after a move received from another device', async () => {
    await downloadFile(original)
    mocks.offline = true
    const moved = { ...changedMetadata, parentId: 'bbbbcccc-1111-2222-3333-123456789abc' }
    expect(mocks.files.get((await downloadFile(moved)).uri)).toBe('original')
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })

  it('rejects an old offline copy after a same-size content replacement, then downloads the new bytes online', async () => {
    await downloadFile(original)
    const replaced = { ...changedMetadata, contentChecksum: 'replaced-checksum' }
    mocks.offline = true
    await expect(downloadFile(replaced)).rejects.toThrow('offline')
    mocks.offline = false
    mocks.content = 'replaced'
    expect(mocks.files.get((await downloadFile(replaced)).uri)).toBe('replaced')
    expect(mocks.download).toHaveBeenCalledTimes(2)
  })

  it('does not reuse bytes after a document was edited and converted back to a blob', async () => {
    await downloadFile(original)
    mocks.offline = true
    const converted = { ...changedMetadata, revision: 3, contentChecksum: 'edited-document-checksum' }
    await expect(downloadFile(converted)).rejects.toThrow('offline')
  })

  it.each([undefined, null])('keeps conservative invalidation for servers without a checksum (%s)', async (contentChecksum) => {
    await downloadFile({ ...original, contentChecksum })
    mocks.offline = true
    await expect(downloadFile({ ...changedMetadata, contentChecksum })).rejects.toThrow('offline')
  })

  it('does not reuse another account’s downloaded copy', async () => {
    await downloadFile(original)
    mocks.userId = 'other-account'
    mocks.offline = true
    await expect(downloadFile(original)).rejects.toThrow('offline')
  })

  it('invalidates legacy cache versions when a server starts supplying content checksums', () => {
    expect(fileContentVersion({ ...original, contentChecksum: undefined })).not.toBe(fileContentVersion(original))
  })
})
