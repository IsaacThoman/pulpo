import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import tar from 'tar-stream'

export interface BackupArchiveEntry {
  name: string
  body: Uint8Array
}

export interface BackupArchiveMetadata {
  sizeBytes: number
  checksum: string
}

export function checksumMatches(value: Uint8Array, expected: string): boolean {
  const hash = createHash('sha256').update(value)
  return [hash.copy().digest('hex'), hash.copy().digest('base64url'), hash.digest('base64')].includes(expected)
}

async function addTarEntry(pack: ReturnType<typeof tar.pack>, entry: BackupArchiveEntry): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    pack.entry({ name: entry.name, size: entry.body.byteLength, mode: 0o600 }, Buffer.from(entry.body), (error) => error ? reject(error) : resolve())
  })
}

async function fileChecksum(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function writeBackupArchive(path: string, entries: AsyncIterable<BackupArchiveEntry>): Promise<BackupArchiveMetadata> {
  const pack = tar.pack()
  const archiveDone = pipeline(pack, createGzip(), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
  try {
    for await (const entry of entries) await addTarEntry(pack, entry)
    pack.finalize()
    await archiveDone
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error('Backup archive failed'))
    await archiveDone.catch(() => undefined)
    throw error
  }
  const [{ size }, checksum] = await Promise.all([stat(path), fileChecksum(path)])
  return { sizeBytes: size, checksum }
}
