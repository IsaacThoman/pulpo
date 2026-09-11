import { createHash } from 'node:crypto'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import tar from 'tar-stream'
import { afterEach, describe, expect, it } from 'vitest'
import { checksumMatches, writeBackupArchive, type BackupArchiveEntry } from './backup-archive.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function readEntries(archive: Uint8Array): Promise<Map<string, Buffer>> {
  const extract = tar.extract()
  const entries = new Map<string, Buffer>()
  const done = new Promise<void>((resolve, reject) => {
    extract.on('finish', resolve)
    extract.on('error', reject)
  })
  extract.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    stream.on('end', () => { entries.set(header.name, Buffer.concat(chunks)); next() })
    stream.resume()
  })
  extract.end(gunzipSync(archive))
  await done
  return entries
}

describe('backup archive', () => {
  it('streams entries to gzip and reports exact integrity metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-test-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'backup.tar.gz')
    async function* entries(): AsyncGenerator<BackupArchiveEntry> {
      yield { name: 'database.json', body: Readable.from(['{"users":', '[]}']), sizeBytes: 12 }
      yield { name: 'blobs/example', body: Buffer.from('attachment') }
      yield { name: 'manifest.json', body: Buffer.from('{"version":1}') }
    }

    const metadata = await writeBackupArchive(path, entries())
    const archive = await readFile(path)

    expect(metadata).toEqual({
      sizeBytes: archive.byteLength,
      checksum: createHash('sha256').update(archive).digest('hex'),
    })
    expect(await readEntries(archive)).toEqual(new Map([
      ['database.json', Buffer.from('{"users":[]}')],
      ['blobs/example', Buffer.from('attachment')],
      ['manifest.json', Buffer.from('{"version":1}')],
    ]))
  })

  it('accepts supported SHA-256 encodings and rejects corruption', () => {
    const body = Buffer.from('backup')
    const hash = createHash('sha256').update(body)
    expect(checksumMatches(body, hash.copy().digest('hex'))).toBe(true)
    expect(checksumMatches(body, hash.copy().digest('base64url'))).toBe(true)
    expect(checksumMatches(body, hash.digest('base64'))).toBe(true)
    expect(checksumMatches(Buffer.from('corrupt'), createHash('sha256').update(body).digest('hex'))).toBe(false)
  })

  it('rejects and closes the archive pipeline when entry production fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-test-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'backup.tar.gz')
    async function* entries(): AsyncGenerator<BackupArchiveEntry> {
      yield { name: 'database.json', body: Buffer.from('{}') }
      throw new Error('blob unavailable')
    }

    await expect(writeBackupArchive(path, entries())).rejects.toThrow('blob unavailable')
  })

  it('propagates input stream errors and closes the source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-test-'))
    temporaryDirectories.push(directory)
    const source = Readable.from((async function* () { yield 'start'; throw new Error('source unavailable') })())
    async function* entries(): AsyncGenerator<BackupArchiveEntry> {
      yield { name: 'database.json', body: source, sizeBytes: 20 }
    }
    await expect(writeBackupArchive(join(directory, 'backup.tar.gz'), entries())).rejects.toThrow('source unavailable')
    expect(source.destroyed).toBe(true)
  })

  it.each([2, 20])('rejects an entry whose declared size is %i but actual size is 5', async (sizeBytes) => {
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-test-'))
    temporaryDirectories.push(directory)
    async function* entries(): AsyncGenerator<BackupArchiveEntry> {
      yield { name: 'database.json', body: Readable.from(['12345']), sizeBytes }
    }
    await expect(writeBackupArchive(join(directory, 'backup.tar.gz'), entries())).rejects.toThrow(/size mismatch/i)
  })

  it('aborts a stalled input stream when archive output fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-test-'))
    temporaryDirectories.push(directory)
    const source = new Readable({ read() { /* Wait indefinitely for input. */ } })
    async function* entries(): AsyncGenerator<BackupArchiveEntry> {
      yield { name: 'database.json', body: source, sizeBytes: 20 }
    }
    await expect(writeBackupArchive(directory, entries())).rejects.toMatchObject({ code: 'EEXIST' })
    expect(source.destroyed).toBe(true)
  })
})
