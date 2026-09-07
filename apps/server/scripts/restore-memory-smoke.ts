// Run with: node --max-old-space-size=96 --import tsx scripts/restore-memory-smoke.ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import tar from 'tar-stream'
import { extractRestoreArchive, restoreBatches, restoreRows, splitRestoreDatabase } from '../src/admin/restore-archive.js'

const directory = await mkdtemp(join(tmpdir(), 'pulpo-restore-memory-'))
try {
  const archive = join(directory, 'large.tar.gz')
  const pack = tar.pack()
  const done = pipeline(pack, createGzip(), createWriteStream(archive))
  void done.catch(() => undefined)
  const row = JSON.stringify({ content: 'x'.repeat(10 * 1024), nested: { enabled: true } })
  const count = 10_000
  const prefix = '{"users":[', suffix = ']}'
  const databaseSize = Buffer.byteLength(prefix + suffix) + count * Buffer.byteLength(row) + count - 1
  await pipeline(Readable.from((async function* () {
    yield prefix
    for (let index = 0; index < count; index++) yield (index ? ',' : '') + row
    yield suffix
  })()), pack.entry({ name: 'database.json', size: databaseSize }))
  const hash = createHash('sha256'), chunk = Buffer.alloc(64 * 1024, 1), blobSize = 384 * 1024 ** 2
  await pipeline(Readable.from((async function* () {
    for (let offset = 0; offset < blobSize; offset += chunk.length) { hash.update(chunk); yield chunk }
  })()), pack.entry({ name: 'blobs/YQ', size: blobSize }))
  const manifest = Buffer.from(JSON.stringify({ format: 'pulpo-instance-backup', version: 1,
    blobs: [{ entry: 'blobs/YQ', objectKey: 'a', checksum: hash.digest('hex') }] }))
  await pipeline(Readable.from([manifest]), pack.entry({ name: 'manifest.json', size: manifest.length }))
  pack.finalize(); await done
  const extracted = await extractRestoreArchive(createReadStream(archive), directory, { size: null, checksum: null })
  assert.equal(extracted.files.get('blobs/YQ')?.size, blobSize)
  const tables = await splitRestoreDatabase(extracted.databasePath, directory)
  let restored = 0
  for await (const batch of restoreBatches(restoreRows(tables.get('users')))) restored += batch.length
  assert.equal(restored, count)
  const peakRssMiB = Math.ceil(process.resourceUsage().maxRSS / 1024)
  assert.ok(peakRssMiB < 320, `Peak RSS ${peakRssMiB} MiB exceeds the 320 MiB smoke-test budget`)
  console.log(JSON.stringify({ databaseMiB: Math.ceil(databaseSize / 1024 ** 2), blobMiB: 384, restoredRows: restored, peakRssMiB }))
} finally { await rm(directory, { recursive: true, force: true }) }
