import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import tar from 'tar-stream'

export type BackupArchiveEntry = {
  name: string
} & ({ body: Uint8Array } | { body: Readable; sizeBytes: number })

export interface BackupArchiveMetadata {
  sizeBytes: number
  checksum: string
}

export function checksumMatches(value: Uint8Array, expected: string): boolean {
  const hash = createHash('sha256').update(value)
  return [hash.copy().digest('hex'), hash.copy().digest('base64url'), hash.digest('base64')].includes(expected)
}

async function addTarEntry(pack: ReturnType<typeof tar.pack>, entry: BackupArchiveEntry, signal: AbortSignal): Promise<void> {
  const streamed = 'sizeBytes' in entry
  const source = streamed ? entry.body : Readable.from([entry.body])
  const size = streamed ? entry.sizeBytes : entry.body.byteLength
  if (!Number.isSafeInteger(size) || size < 0) {
    source.destroy()
    throw new Error('Invalid backup entry size')
  }
  await pipeline(source, pack.entry({ name: entry.name, size, mode: 0o600 }), { signal })
}

async function fileChecksum(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function writeBackupArchive(path: string, entries: AsyncIterable<BackupArchiveEntry>): Promise<BackupArchiveMetadata> {
  const pack = tar.pack()
  const controller = new AbortController()
  let archiveError: unknown
  const archiveDone = pipeline(pack, createGzip(), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
  // Observe output failures immediately, including while an entry is waiting
  // for input. Abort the active source so it cannot leave the job hanging.
  void archiveDone.catch((error: unknown) => { archiveError = error; controller.abort(error) })
  try {
    for await (const entry of entries) await addTarEntry(pack, entry, controller.signal)
    pack.finalize()
    await archiveDone
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error('Backup archive failed'))
    await archiveDone.catch(() => undefined)
    throw archiveError ?? error
  }
  const [{ size }, checksum] = await Promise.all([stat(path), fileChecksum(path)])
  return { sizeBytes: size, checksum }
}
