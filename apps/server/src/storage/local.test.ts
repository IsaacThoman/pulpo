import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBlobStore } from './local.js'

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
