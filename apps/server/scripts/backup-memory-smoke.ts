// Exercise the production serializer/archive path beyond Node's single-string limit.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageBackupBlob, writeBackupArchive, type BackupArchiveEntry } from '../src/admin/backup-archive.js'
import { writeBackupDatabase } from '../src/admin/backup-database.js'
import { extractRestoreArchive, restoreRows, splitRestoreDatabase } from '../src/admin/restore-archive.js'

const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-memory-'))
try {
  const databasePath = join(directory, 'database.json')
  const count = 56_000, content = 'x'.repeat(10 * 1024)
  function* rows() {
    for (let id = 0; id < count; id++) yield { id, content }
  }
  // Repeated content keeps the fixture small in memory; the output must still
  // exceed the production limit. This does not test database-query memory.
  await writeBackupDatabase(databasePath, { users: rows(), empty: [] })
  const databaseSize = (await stat(databasePath)).size
  assert.ok(databaseSize > 536_870_888, 'Fixture must exceed the production string limit')
  const blobPath = join(directory, 'blob')
  const blobChunk = Buffer.alloc(64 * 1024, 23), blobSize = 384 * 1024 * 1024
  function* blobChunks() { for (let offset = 0; offset < blobSize; offset += blobChunk.length) yield blobChunk }
  const blobHash = createHash('sha256')
  for (const chunk of blobChunks()) blobHash.update(chunk)
  const blob = await stageBackupBlob(blobPath, Readable.from(blobChunks()), blobHash.digest('hex'))
  assert.equal(blob.sizeBytes, blobSize)
  const archivePath = join(directory, 'backup.tar.gz')
  async function* entries(): AsyncGenerator<BackupArchiveEntry> {
    yield { name: 'database.json', body: createReadStream(databasePath), sizeBytes: databaseSize }
    yield { name: 'blobs/YQ', body: createReadStream(blobPath), sizeBytes: blob.sizeBytes }
    yield { name: 'manifest.json', body: Buffer.from(JSON.stringify({ format: 'pulpo-instance-backup', version: 1, blobs: [{ entry: 'blobs/YQ', objectKey: 'a', checksum: blob.checksum }] })) }
  }
  const metadata = await writeBackupArchive(archivePath, entries())
  const extracted = await extractRestoreArchive(createReadStream(archivePath), directory, { size: metadata.sizeBytes, checksum: metadata.checksum })
  assert.equal(extracted.files.get('database.json')?.size, databaseSize)
  assert.equal(extracted.files.get('blobs/YQ')?.size, blobSize)
  const tables = await splitRestoreDatabase(extracted.databasePath, directory)
  let restored = 0
  for await (const row of restoreRows(tables.get('users'))) {
    assert.equal(row.id, restored++)
    assert.equal(row.content, content)
  }
  assert.equal(restored, count)
  assert.ok(tables.has('empty'))
  for await (const _row of restoreRows(tables.get('empty'))) assert.fail('Expected an empty table')
  const peakRssMiB = Math.ceil(process.resourceUsage().maxRSS / 1024)
  assert.ok(peakRssMiB < 320, `Peak RSS ${peakRssMiB} MiB exceeds the 320 MiB smoke-test budget`)
  console.log(JSON.stringify({ databaseBytes: databaseSize, blobBytes: blobSize, restoredRows: restored, peakRssMiB }))
} finally { await rm(directory, { recursive: true, force: true }) }
