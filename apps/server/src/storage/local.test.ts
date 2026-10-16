import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBlobStore, localObjectRouteBase } from './local.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local blob streaming', () => {
  it('writes and reads objects as streams', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulpo-local-store-'))
    roots.push(root)
    const store = new LocalBlobStore(root)
    const body = Buffer.from('streamed local attachment')
    await store.putStream('users/user/attachments/file', Readable.from([
      body.subarray(0, 8),
      body.subarray(8),
    ]), { contentType: 'application/octet-stream', contentLength: body.byteLength })

    expect(await readFile(join(root, 'users/user/attachments/file'))).toEqual(body)
    const chunks: Buffer[] = []
    for await (const chunk of await store.getStream('users/user/attachments/file')) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(body)
  })
})

describe('local blob copies', () => {
  it('duplicates an object under a new key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulpo-local-store-'))
    roots.push(root)
    const store = new LocalBlobStore(root)
    await store.put('users/u/files/a', Buffer.from('bytes'), { contentType: 'text/plain' })
    await store.copy('users/u/files/a', 'users/u/files/b')
    expect(await readFile(join(root, 'users/u/files/b'), 'utf8')).toBe('bytes')
    expect(await readFile(join(root, 'users/u/files/a'), 'utf8')).toBe('bytes')
  })
})

describe('local blob URLs', () => {
  it('routes Files objects to the Files API and everything else to attachments', async () => {
    const store = new LocalBlobStore('/unused')
    expect(localObjectRouteBase('users/u1/files/f1')).toBe('/api/files')
    expect(localObjectRouteBase('restored/restore-id/files/f1')).toBe('/api/files')
    expect(localObjectRouteBase('users/u1/attachments/a1')).toBe('/api/attachments')
    expect(localObjectRouteBase('exports/u1/files/x')).toBe('/api/attachments')
    expect(await store.createUploadUrl('users/u1/files/f1')).toBe('/api/files/local-upload/users%2Fu1%2Ffiles%2Ff1')
    expect(await store.createDownloadUrl('users/u1/attachments/a1')).toBe('/api/attachments/local-download/users%2Fu1%2Fattachments%2Fa1')
  })
})
