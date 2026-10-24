// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  exists: true,
  requests: [] as string[],
}))

vi.mock('expo-file-system', () => {
  class File {
    uri: string
    constructor(uri: string) { this.uri = uri }
    get exists() { return mocks.exists }
    upload(...args: unknown[]) { return mocks.upload(...args) }
  }
  return { Directory: class {}, File, Paths: {} }
})
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  apiRequest: async (path: string) => {
    mocks.requests.push(path)
    return { node: { id: 'placeholder' }, uploadUrl: '/upload/placeholder', uploadHeaders: {} }
  },
  apiUrl: (path: string) => `https://pulpo.test${path}`,
  nativeAuthorizationHeaders: () => ({}),
}))
vi.mock('../../data/database', () => ({ cacheNamespace: () => 'namespace' }))
vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => ({ config: null }) } }))
vi.mock('./cache', () => ({ cachedFileUri: async () => null, recordCachedFile: async () => undefined }))

const { uploadFile } = await import('./api')

const upload = { uri: 'documents/pending-uploads/a/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }

beforeEach(() => {
  mocks.upload.mockReset()
  mocks.exists = true
  mocks.requests.length = 0
})

describe('uploadFile', () => {
  it('waits for a connection when the system transfer fails, whatever its wording', async () => {
    // As OkHttp words it on Android; other platforms and languages differ.
    mocks.upload.mockRejectedValue(new Error('Unable to upload a file: Unable to resolve host "pulpo.test"'))
    await expect(uploadFile(null, upload)).rejects.toMatchObject({ retry: true })
    expect(mocks.requests).toEqual(['/api/files/uploads'])
  })

  it('fails for good when the staged file is gone', async () => {
    mocks.exists = false
    mocks.upload.mockRejectedValue(new Error('File not found'))
    const error = await uploadFile(null, upload).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as { retry?: boolean }).retry).toBeUndefined()
  })
})
