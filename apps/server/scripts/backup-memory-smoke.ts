// Exercise the production serializer/archive path beyond Node's single-string limit.
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBackupArchive, type BackupArchiveEntry } from '../src/admin/backup-archive.js'
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
  const archivePath = join(directory, 'backup.tar.gz')
  async function* entries(): AsyncGenerator<BackupArchiveEntry> {
    yield { name: 'database.json', body: createReadStream(databasePath), sizeBytes: databaseSize }
    yield { name: 'manifest.json', body: Buffer.from(JSON.stringify({ format: 'pulpo-instance-backup', version: 1, blobs: [] })) }
  }
  const metadata = await writeBackupArchive(archivePath, entries())
  const extracted = await extractRestoreArchive(createReadStream(archivePath), directory, { size: metadata.sizeBytes, checksum: metadata.checksum })
  assert.equal(extracted.files.get('database.json')?.size, databaseSize)
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
  console.log(JSON.stringify({ databaseBytes: databaseSize, restoredRows: restored, peakRssMiB }))
} finally { await rm(directory, { recursive: true, force: true }) }
