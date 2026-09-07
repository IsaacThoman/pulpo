import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import tar from 'tar-stream'
import streamJson from 'stream-json'
import Assembler from 'stream-json/Assembler.js'
import { z } from 'zod'

const MAX_EXPANDED_BYTES = 100 * 1024 ** 3
const MAX_MANIFEST_BYTES = 64 * 1024 ** 2
const MAX_ROW_BYTES = 64 * 1024 ** 2
const manifestSchema = z.object({
  format: z.literal('pulpo-instance-backup'), version: z.literal(1),
  blobs: z.array(z.object({ entry: z.string(), objectKey: z.string().min(1), checksum: z.string().min(1) })),
})
export type RestoreRow = Record<string, unknown>

export interface ExtractedFile { path: string; size: number; checksums: string[] }

/** Never extract an archive-supplied path, link, or device onto the filesystem. */
export async function extractRestoreArchive(source: Readable, directory: string, expected: {
  size: number | null; checksum: string | null
}) {
  const files = new Map<string, ExtractedFile>()
  const archiveHash = createHash('sha256'); let archiveSize = 0; let expandedSize = 0; let entryCount = 0
  const extract = tar.extract()
  const done = pipeline(source, new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      archiveSize += chunk.length
      if (archiveSize > (expected.size ?? 20 * 1024 ** 3)) return callback(new Error('Backup archive size mismatch'))
      archiveHash.update(chunk); callback(null, chunk)
    },
  }), createGunzip(), extract)
  // Observe immediately: a source/gzip error may happen while an entry is being
  // written. The original rejection is still awaited below.
  void done.catch(() => undefined)
  try {
    for await (const entry of extract) {
      const { name, type, size = 0 } = entry.header
      if (type !== 'file' || !/^(database\.json|manifest\.json|blobs\/[A-Za-z0-9_-]+)$/.test(name)) throw new Error('Unsupported backup archive entry')
      expandedSize += size
      if (expandedSize > MAX_EXPANDED_BYTES || entryCount >= 1_000_000) throw new Error('Backup exceeds the extraction limit')
      if (name === 'manifest.json' && size > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large')
      const path = join(directory, `entry-${entryCount++}`)
      const hash = createHash('sha256'); let actualSize = 0
      await pipeline(entry, new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          actualSize += chunk.length; hash.update(chunk); callback(null, chunk)
        },
      }), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
      if (actualSize !== size) throw new Error('Backup entry size mismatch')
      const checksums = [hash.copy().digest('hex'), hash.copy().digest('base64url'), hash.digest('base64')]
      const previous = files.get(name)
      if (previous && (name === 'database.json' || name === 'manifest.json' || previous.checksums[0] !== checksums[0])) throw new Error(`Conflicting duplicate backup entry: ${name}`)
      files.set(name, { path, size, checksums })
    }
    await done
  } catch (error) {
    extract.destroy(error instanceof Error ? error : new Error('Invalid backup archive'))
    await done.catch(() => undefined)
    throw error
  }
  if (expected.size !== null && archiveSize !== expected.size) throw new Error('Backup archive size mismatch')
  if (expected.checksum && archiveHash.digest('hex') !== expected.checksum) throw new Error('Backup archive checksum failed')
  const manifestFile = files.get('manifest.json'), databaseFile = files.get('database.json')
  if (!manifestFile || !databaseFile) throw new Error('Backup is missing its manifest or database')
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile.path, 'utf8')))
  const objectKeys = new Map<string, string>(), entries = new Map<string, string>()
  const uniqueBlobs: typeof manifest.blobs = []
  for (const blob of manifest.blobs) {
    const file = files.get(blob.entry)
    if (!blob.entry.startsWith('blobs/') || !file || !file.checksums.includes(blob.checksum)) throw new Error(`Blob checksum failed: ${blob.objectKey}`)
    if (objectKeys.has(blob.objectKey)) {
      if (objectKeys.get(blob.objectKey) !== blob.entry) throw new Error('Conflicting blob in backup manifest')
      continue
    }
    if (entries.has(blob.entry)) throw new Error('Conflicting blob in backup manifest')
    objectKeys.set(blob.objectKey, blob.entry); entries.set(blob.entry, blob.objectKey); uniqueBlobs.push(blob)
  }
  manifest.blobs = uniqueBlobs
  return { files, manifest, databasePath: databaseFile.path }
}

/** Convert the v1 database object into disk-backed tables, one row at a time. */
export async function splitRestoreDatabase(path: string, directory: string): Promise<Map<string, string>> {
  const tables = new Map<string, string>()
  const parser = streamJson.parser({ streamValues: true })
  const done = pipeline(createReadStream(path), parser)
  void done.catch(() => undefined)
  let root = false, ended = false, inTable = false, table: string | undefined
  let output: Awaited<ReturnType<typeof open>> | undefined
  let assembler: Assembler | undefined
  let rowSize = 0
  let tableKeySize = 0
  try {
    for await (const token of parser) {
      if (assembler) {
        rowSize += token.name.endsWith('Chunk') ? Buffer.byteLength(JSON.stringify(token.value)) : 8
        if (rowSize > MAX_ROW_BYTES) throw new Error('A backup database row exceeds the 64 MiB limit')
        if (assembler.depth > 1000) throw new Error('Backup database nesting is too deep')
        if (token.name === 'keyValue' && token.value === '__proto__') {
          Object.defineProperty(assembler.current, '__proto__', { value: undefined, writable: true, enumerable: true, configurable: true })
        }
        assembler.consume(token)
        if (assembler.done) {
          await output!.writeFile(`${JSON.stringify(assembler.current)}\n`)
          assembler = undefined
        }
        continue
      }
      if (token.name === 'startKey') tableKeySize = 0
      if (token.name.endsWith('Chunk')) {
        tableKeySize += Buffer.byteLength(token.value)
        if (tableKeySize > 100) throw new Error('Backup table names must not exceed 100 bytes')
      }
      // Packed keys/scalars carry the value; streaming token fragments are
      // needed only to bound memory while assembling a row.
      if (['startKey', 'endKey', 'stringChunk', 'startString', 'endString', 'numberChunk', 'startNumber', 'endNumber'].includes(token.name)) continue
      if (token.name === 'startObject' && !root) { root = true; continue }
      if (ended || !root) throw new Error('Backup database must be an object of table arrays')
      if (token.name === 'keyValue' && !inTable && table === undefined) {
        table = token.value as string
        if (!/^[a-z][a-z0-9_]{0,99}$/.test(table) || tables.has(table) || tables.size >= 100) throw new Error('Invalid or duplicate backup table')
      } else if (token.name === 'startArray' && table && !inTable) {
        const tablePath = join(directory, `table-${tables.size}.jsonl`)
        tables.set(table, tablePath); output = await open(tablePath, 'wx', 0o600); inTable = true
      } else if (token.name === 'startObject' && inTable) {
        assembler = new Assembler(); assembler.consume(token); rowSize = 0
      } else if (token.name === 'endArray' && inTable) {
        await output!.close(); output = undefined; table = undefined; inTable = false
      } else if (token.name === 'endObject' && !inTable && table === undefined) ended = true
      else throw new Error('Backup tables must contain objects')
    }
    await done
    if (!ended) throw new Error('Incomplete backup database')
    return tables
  } catch (error) {
    parser.destroy(error instanceof Error ? error : new Error('Invalid backup database'))
    await done.catch(() => undefined)
    throw error
  } finally { await output?.close() }
}

export async function* restoreRows(path?: string): AsyncGenerator<RestoreRow> {
  if (!path) return
  const source = createReadStream(path)
  const lines = createInterface({ input: source, crlfDelay: Infinity })
  try { for await (const line of lines) yield JSON.parse(line) as RestoreRow }
  finally { lines.close(); source.destroy() }
}

export async function* restoreBatches(rows: AsyncIterable<RestoreRow>): AsyncGenerator<RestoreRow[]> {
  let batch: RestoreRow[] = [], size = 0
  for await (const row of rows) {
    const rowSize = Buffer.byteLength(JSON.stringify(row))
    if (batch.length && (size + rowSize > 1024 * 1024 || batch.length >= 100)) { yield batch; batch = []; size = 0 }
    batch.push(row); size += rowSize
  }
  if (batch.length) yield batch
}

export async function readSmallRestoreTable(path?: string): Promise<RestoreRow[]> {
  if (!path) return []
  if ((await stat(path)).size > MAX_ROW_BYTES) throw new Error('Backup settings exceed the 64 MiB limit')
  const rows: RestoreRow[] = []
  for await (const row of restoreRows(path)) rows.push(row)
  return rows
}
