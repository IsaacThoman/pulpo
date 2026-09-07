import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { writeBackupArchive } from './backup-archive.js'
import { extractRestoreArchive, restoreBatches, restoreRows, splitRestoreDatabase } from './restore-archive.js'

const directories: string[] = []
async function directory() { const path = await mkdtemp(join(tmpdir(), 'pulpo-restore-test-')); directories.push(path); return path }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const checksum = (body: Uint8Array) => createHash('sha256').update(body).digest('hex')

async function archive(extra?: { name: string; body: Buffer }, corruptChecksum = false) {
  const dir = await directory(), path = join(dir, 'backup.tar.gz'), body = Buffer.from('attachment data')
  const manifest = { format: 'pulpo-instance-backup', version: 1,
    blobs: [{ entry: 'blobs/YQ', objectKey: 'a', checksum: corruptChecksum ? 'bad' : checksum(body) }] }
  async function* entries() {
    yield { name: 'database.json', body: Buffer.from('{"users":[{"id":"admin","role":"admin"}]}') }
    yield { name: 'blobs/YQ', body }
    if (extra) yield extra
    yield { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) }
  }
  const metadata = await writeBackupArchive(path, entries())
  return { dir, path, metadata }
}

describe('streamed restore archives', () => {
  it('extracts validated blobs to generated paths and preserves database rows', async () => {
    const { dir, path, metadata } = await archive()
    const result = await extractRestoreArchive(createReadStream(path, { highWaterMark: 7 }), dir, { size: metadata.sizeBytes, checksum: metadata.checksum })
    expect(await readFile(result.files.get('blobs/YQ')!.path, 'utf8')).toBe('attachment data')
    const tables = await splitRestoreDatabase(result.databasePath, dir)
    const rows = []
    for await (const row of restoreRows(tables.get('users'))) rows.push(row)
    expect(rows).toEqual([{ id: 'admin', role: 'admin' }])
  })
  it('accepts identical duplicate blobs from older backup writers', async () => {
    const { dir, path } = await archive({ name: 'blobs/YQ', body: Buffer.from('attachment data') })
    await expect(extractRestoreArchive(createReadStream(path), dir, { size: null, checksum: null })).resolves.toMatchObject({ manifest: { version: 1 } })
  })
  it.each([
    ['../escape', 'Unsupported'], ['blobs/../../escape', 'Unsupported'],
    ['database.json', 'Conflicting duplicate'], ['blobs/YQ', 'Conflicting duplicate'],
  ])('rejects unsafe or conflicting entry %s', async (name, message) => {
    const { dir, path } = await archive({ name: name!, body: Buffer.from('different') })
    await expect(extractRestoreArchive(createReadStream(path), dir, { size: null, checksum: null })).rejects.toThrow(message)
  })
  it('rejects a corrupt blob before database processing', async () => {
    const { dir, path } = await archive(undefined, true)
    await expect(extractRestoreArchive(createReadStream(path), dir, { size: null, checksum: null })).rejects.toThrow('Blob checksum failed')
  })
  it('rejects truncated gzip and mismatched archive integrity metadata', async () => {
    const { path, metadata } = await archive()
    const bytes = await readFile(path)
    await expect(extractRestoreArchive(Readable.from([bytes.subarray(0, bytes.length - 15)]), await directory(), { size: null, checksum: null })).rejects.toThrow()
    await expect(extractRestoreArchive(Readable.from([bytes]), await directory(), { size: metadata.sizeBytes + 1, checksum: null })).rejects.toThrow('size mismatch')
    await expect(extractRestoreArchive(Readable.from([bytes]), await directory(), { size: null, checksum: 'bad' })).rejects.toThrow('checksum failed')
  })
  it('propagates an interrupted source without hanging extraction', async () => {
    const source = Readable.from((async function* () { yield gzipSync(Buffer.alloc(1024)); throw new Error('chunk missing') })())
    await expect(extractRestoreArchive(source, await directory(), { size: null, checksum: null })).rejects.toThrow()
  })
  it('streams large table arrays, nested JSON, escapes, Unicode, and empty tables', async () => {
    const dir = await directory(), path = join(dir, 'database.json')
    const rows = Array.from({ length: 3000 }, (_, id) => ({ id, content: '🦑\n"quoted"'.repeat(30), nested: [null, true, { price: -1.25e3 }] }))
    await writeFile(path, JSON.stringify({ users: rows, empty: [] }))
    const tables = await splitRestoreDatabase(path, dir)
    let count = 0, batches = 0
    for await (const batch of restoreBatches(restoreRows(tables.get('users')))) {
      expect(batch.length).toBeLessThanOrEqual(100)
      expect(batch[0]).toEqual(rows[count]); count += batch.length; batches++
    }
    expect(count).toBe(3000); expect(batches).toBe(30)
    expect(await readFile(tables.get('empty')!, 'utf8')).toBe('')
  })
  it.each(['[]', '{"users":{}}', '{"users":[null]}', '{"users":[],"users":[]}', '{"../bad":[]}', '{"users":[{}]'])('rejects malformed database %s', async (body) => {
    const dir = await directory(), path = join(dir, 'database.json')
    await writeFile(path, body)
    await expect(splitRestoreDatabase(path, dir)).rejects.toThrow()
  })
})
