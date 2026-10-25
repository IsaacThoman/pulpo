import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Encrypter, generateHybridIdentity, generateIdentity, identityToRecipient } from 'age-encryption'
import tar from 'tar-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleSnapshot, fetchS3Object } from './backup-assemble.js'

let directory: string

async function encrypt(recipient: string, bytes: Uint8Array): Promise<Uint8Array> {
  const encrypter = new Encrypter(); encrypter.addRecipient(recipient)
  return encrypter.encrypt(bytes)
}

async function tarGz(entries: Array<[string, Buffer]>): Promise<Buffer> {
  const pack = tar.pack()
  for (const [name, body] of entries) pack.entry({ name }, body)
  pack.finalize()
  const chunks: Buffer[] = []
  for await (const chunk of pack) chunks.push(chunk as Buffer)
  return gzipSync(Buffer.concat(chunks))
}

async function readTarGz(path: string): Promise<Map<string, Buffer>> {
  const extract = tar.extract()
  extract.end(gunzipSync(await readFile(path)))
  const files = new Map<string, Buffer>()
  for await (const entry of extract) {
    const chunks: Buffer[] = []; for await (const chunk of entry) chunks.push(chunk as Buffer)
    files.set(entry.header.name, Buffer.concat(chunks))
  }
  return files
}

/** Write blobs as Pulpo stores them (one encrypted object per distinct content) plus an encrypted snapshot. */
async function fixture(recipient: string, files: Array<{ objectKey: string; body: Buffer }>, manifestOverride?: unknown) {
  const bucket = join(directory, 'bucket')
  await mkdir(join(bucket, 'pulpo', 'blobs'), { recursive: true })
  const stored = new Map<string, string>()
  const blobs = []
  for (const file of files) {
    const checksum = createHash('sha256').update(file.body).digest('hex')
    let storageKey = stored.get(checksum)
    if (!storageKey) {
      storageKey = `pulpo/blobs/${randomUUID()}.age`
      stored.set(checksum, storageKey)
      await writeFile(join(bucket, storageKey), await encrypt(recipient, file.body))
    }
    blobs.push({ objectKey: file.objectKey, checksum, sizeBytes: file.body.length, storageKey })
  }
  const manifest = manifestOverride ?? { format: 'pulpo-instance-snapshot', version: 1, createdAt: '2026-11-01T00:00:00.000Z', tables: ['users'], blobs }
  const snapshot = await tarGz([['database.json', Buffer.from('{"users":[]}')], ['manifest.json', Buffer.from(JSON.stringify(manifest))]])
  const snapshotPath = join(directory, 'snapshot.tar.gz.age')
  await writeFile(snapshotPath, await encrypt(recipient, snapshot))
  return { bucket, snapshotPath, blobs }
}

async function identityFile(identity: string): Promise<string> {
  const path = join(directory, `identity-${randomUUID()}.txt`)
  await writeFile(path, `# created: 2026-11-01T00:00:00Z\n# public key: ${await identityToRecipient(identity)}\n${identity}\n`)
  return path
}

describe('pulpo backup assemble', () => {
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pulpo-assemble-test-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('rebuilds a restorable archive with a post-quantum identity, writing shared blobs under each key', async () => {
    const identity = await generateHybridIdentity()
    const shared = Buffer.from('shared bytes'), unique = Buffer.from('unique bytes')
    const { bucket, snapshotPath, blobs } = await fixture(await identityToRecipient(identity), [
      { objectKey: 'users/a/attachments/1', body: shared },
      { objectKey: 'users/b/attachments/2', body: shared },
      { objectKey: 'users/a/files/3', body: unique },
    ])
    const outputPath = join(directory, 'restorable.tar.gz')
    const progress = vi.fn()
    // A flat download of the blobs/ folder works as well as a mirror of the bucket.
    const result = await assembleSnapshot({
      snapshotPath, identityPath: await identityFile(identity), outputPath,
      blobs: { kind: 'directory', path: join(bucket, 'pulpo', 'blobs') }, onProgress: progress,
    })
    expect(result).toMatchObject({ blobs: 3, storedObjects: 2, createdAt: '2026-11-01T00:00:00.000Z' })
    expect(progress).toHaveBeenLastCalledWith(2, 2)
    const files = await readTarGz(outputPath)
    const manifest = JSON.parse(files.get('manifest.json')!.toString())
    expect(manifest).toMatchObject({ format: 'pulpo-instance-backup', version: 1, tables: ['users'] })
    expect(manifest.blobs).toHaveLength(3)
    for (const [index, entry] of manifest.blobs.entries()) {
      expect(entry).toEqual({ entry: `blobs/${Buffer.from(blobs[index]!.objectKey).toString('base64url')}`, objectKey: blobs[index]!.objectKey, checksum: blobs[index]!.checksum })
      expect(files.get(entry.entry)).toEqual(index === 2 ? unique : shared)
    }
    expect(files.get('database.json')!.toString()).toBe('{"users":[]}')
    expect([...files.keys()][0]).toBe('database.json')
    expect([...files.keys()].at(-1)).toBe('manifest.json')
  })

  it('refuses to overwrite an existing output file', async () => {
    const identity = await generateIdentity()
    const { bucket, snapshotPath } = await fixture(await identityToRecipient(identity), [{ objectKey: 'a', body: Buffer.from('a') }])
    const outputPath = join(directory, 'existing.tar.gz')
    await writeFile(outputPath, 'keep me')
    await expect(assembleSnapshot({ snapshotPath, identityPath: await identityFile(identity), outputPath, blobs: { kind: 'directory', path: bucket } }))
      .rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(outputPath, 'utf8')).toBe('keep me')
  })

  it('rejects a tampered blob and leaves no partial archive behind', async () => {
    const identity = await generateIdentity(), recipient = await identityToRecipient(identity)
    const { bucket, snapshotPath, blobs } = await fixture(recipient, [{ objectKey: 'a', body: Buffer.from('original') }])
    await writeFile(join(bucket, blobs[0]!.storageKey), await encrypt(recipient, Buffer.from('tampered')))
    const outputPath = join(directory, 'out.tar.gz')
    await expect(assembleSnapshot({ snapshotPath, identityPath: await identityFile(identity), outputPath, blobs: { kind: 'directory', path: bucket } }))
      .rejects.toThrow('failed its checksum')
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('names the missing blob', async () => {
    const identity = await generateIdentity()
    const { snapshotPath, blobs } = await fixture(await identityToRecipient(identity), [{ objectKey: 'a', body: Buffer.from('a') }])
    await expect(assembleSnapshot({ snapshotPath, identityPath: await identityFile(identity), outputPath: join(directory, 'out.tar.gz'), blobs: { kind: 'directory', path: join(directory, 'empty') } }))
      .rejects.toThrow(blobs[0]!.storageKey)
  })

  it('explains a wrong identity, a public key, and an archive that needs no assembly', async () => {
    const identity = await generateIdentity(), recipient = await identityToRecipient(identity)
    const { bucket, snapshotPath } = await fixture(recipient, [{ objectKey: 'a', body: Buffer.from('a') }])
    const options = { snapshotPath, outputPath: join(directory, 'out.tar.gz'), blobs: { kind: 'directory' as const, path: bucket } }
    await expect(assembleSnapshot({ ...options, identityPath: await identityFile(await generateIdentity()) })).rejects.toThrow('Unable to decrypt with the provided identity')
    const publicKeyPath = join(directory, 'recipient.txt')
    await writeFile(publicKeyPath, `${recipient}\n`)
    await expect(assembleSnapshot({ ...options, identityPath: publicKeyPath })).rejects.toThrow('AGE-SECRET-KEY')
    const archive = await fixture(recipient, [], { format: 'pulpo-instance-backup', version: 1, blobs: [] })
    await expect(assembleSnapshot({ ...options, snapshotPath: archive.snapshotPath, identityPath: await identityFile(identity) })).rejects.toThrow('already a self-contained archive')
  })

  it('accepts a snapshot that was already decrypted with the age CLI', async () => {
    const identity = await generateIdentity()
    const { bucket, snapshotPath } = await fixture(await identityToRecipient(identity), [{ objectKey: 'a', body: Buffer.from('a') }])
    const { Decrypter } = await import('age-encryption')
    const decrypter = new Decrypter(); decrypter.addIdentity(identity)
    const decryptedPath = join(directory, 'snapshot.tar.gz')
    await writeFile(decryptedPath, await decrypter.decrypt(await readFile(snapshotPath)))
    const outputPath = join(directory, 'out.tar.gz')
    await assembleSnapshot({ snapshotPath: decryptedPath, identityPath: await identityFile(identity), outputPath, blobs: { kind: 'directory', path: bucket } })
    expect((await readTarGz(outputPath)).get(`blobs/${Buffer.from('a').toString('base64url')}`)).toEqual(Buffer.from('a'))
  })
})

describe('signed S3 downloads', () => {
  const location = { endpoint: 'https://s3.us-west-004.backblazeb2.com/', region: 'us-west-004', bucket: 'pulpo-backups', accessKeyId: 'key-id', secretAccessKey: 'secret' }

  it('signs a path-style GET with strictly encoded key segments', async () => {
    const fetchImpl = vi.fn(async () => new Response('ciphertext'))
    const body = await fetchS3Object(location, "pulpo/blobs/it's (1)*.age", new Date('2026-11-01T02:03:04.567Z'), fetchImpl as unknown as typeof fetch)
    const chunks: Buffer[] = []; for await (const chunk of body) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('ciphertext')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, { headers: Record<string, string> }]
    expect(url.href).toBe('https://s3.us-west-004.backblazeb2.com/pulpo-backups/pulpo/blobs/it%27s%20%281%29%2A.age')
    expect(init.headers['x-amz-date']).toBe('20261101T020304Z')
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id\/20261101\/us-west-004\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    expect(init.headers.authorization).not.toContain('secret')
  })

  it('reports the storage error message', async () => {
    const fetchImpl = vi.fn(async () => new Response('<Error><Code>AccessDenied</Code><Message>not entitled</Message></Error>', { status: 403 }))
    await expect(fetchS3Object(location, 'pulpo/blobs/x.age', new Date(), fetchImpl as unknown as typeof fetch)).rejects.toThrow('Downloading pulpo/blobs/x.age failed with HTTP 403: not entitled')
  })
})
