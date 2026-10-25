import { createHash, createHmac, randomUUID } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { copyFile, link, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { createGunzip, createGzip } from 'node:zlib'
import { Decrypter } from 'age-encryption'
import tar from 'tar-stream'
import { backupSnapshotManifestSchema, type BackupSnapshotManifest } from '@pulpo/contracts'

const MAX_MANIFEST_BYTES = 64 * 1024 ** 2
const PREFETCH = 4
const FETCH_ATTEMPTS = 3
const ALREADY_ARCHIVE = 'This is already a self-contained archive. Decrypt it with age and upload it to Pulpo directly.'

export interface S3Location {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export type BlobSource = { kind: 'directory'; path: string } | ({ kind: 's3' } & S3Location)

export interface AssembleOptions {
  snapshotPath: string
  identityPath: string
  outputPath: string
  blobs: BlobSource
  onProgress?: (completed: number, total: number) => void
}

export interface AssembleResult {
  createdAt: string
  blobs: number
  storedObjects: number
  outputPath: string
  sizeBytes: number
}

/** Identity files may hold several keys plus `#` comments, as written by age-keygen. */
export async function readIdentities(path: string): Promise<string[]> {
  const identities = (await readFile(path, 'utf8')).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  if (!identities.length || identities.some(line => !line.startsWith('AGE-SECRET-KEY-'))) {
    throw new Error('The identity file must contain AGE-SECRET-KEY-… lines, such as one created by age-keygen')
  }
  return identities
}

function decrypter(identities: string[]): Decrypter {
  const result = new Decrypter()
  for (const identity of identities) result.addIdentity(identity)
  return result
}

async function decryptStream(source: Readable, identities: string[]): Promise<Readable> {
  try {
    const plaintext = await decrypter(identities).decrypt(Readable.toWeb(source) as ReadableStream<Uint8Array>)
    return Readable.fromWeb(plaintext as unknown as NodeReadableStream<Uint8Array>)
  } catch (error) {
    source.destroy()
    throw new Error(`Unable to decrypt with the provided identity: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

async function startsWithAgeHeader(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(22)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return header.subarray(0, bytesRead).toString('utf8') === 'age-encryption.org/v1\n'
  } finally {
    await handle.close()
  }
}

/** S3 path segments must be encoded with RFC 3986 unreserved characters only. */
function encodeKey(key: string): string {
  return key.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest()

/** Signed path-style GET (AWS Signature Version 4), enough to read backup objects from Backblaze B2. */
export async function fetchS3Object(location: S3Location, key: string, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<Readable> {
  const url = new URL(`${location.endpoint.replace(/\/+$/, '')}/${encodeKey(location.bucket)}/${encodeKey(key)}`)
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const date = amzDate.slice(0, 8)
  const payloadHash = sha256('')
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['GET', url.pathname, '', `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`, signedHeaders, payloadHash].join('\n')
  const scope = `${date}/${location.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${location.secretAccessKey}`, date), location.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const response = await fetchImpl(url, {
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${location.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  })
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).match(/<Message>([^<]*)<\/Message>/)?.[1]
    throw new Error(`Downloading ${key} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
}

async function openBlob(source: BlobSource, storageKey: string): Promise<Readable> {
  if (source.kind === 's3') return fetchS3Object(source, storageKey)
  // Accept a mirror of the whole bucket or just the downloaded blobs folder.
  for (const candidate of [join(source.path, storageKey), join(source.path, basename(storageKey))]) {
    if (await stat(candidate).then(entry => entry.isFile(), () => false)) return createReadStream(candidate)
  }
  throw new Error(`Blob ${storageKey} was not found in ${source.path}`)
}

async function readSnapshot(path: string, identities: string[], directory: string): Promise<{ manifest: BackupSnapshotManifest; databasePath: string; databaseSize: number }> {
  const encrypted = await startsWithAgeHeader(path)
  const source = encrypted ? await decryptStream(createReadStream(path), identities) : createReadStream(path)
  const extract = tar.extract()
  const done = pipeline(source, createGunzip(), extract)
  void done.catch(() => undefined)
  const databasePath = join(directory, 'database.json')
  let manifestText: string | undefined, databaseSize: number | undefined
  try {
    for await (const entry of extract) {
      const { name, type, size = 0 } = entry.header
      if (type !== 'file') throw new Error('The snapshot contains an unsupported entry')
      if (name === 'manifest.json' && manifestText === undefined) {
        if (size > MAX_MANIFEST_BYTES) throw new Error('The snapshot manifest is too large')
        const chunks: Buffer[] = []
        for await (const chunk of entry) chunks.push(chunk as Buffer)
        manifestText = Buffer.concat(chunks).toString('utf8')
      } else if (name === 'database.json' && databaseSize === undefined) {
        await pipeline(entry, createWriteStream(databasePath, { flags: 'wx', mode: 0o600 }))
        databaseSize = size
      } else if (name.startsWith('blobs/')) {
        throw new Error(ALREADY_ARCHIVE)
      } else {
        throw new Error(`The snapshot contains an unexpected entry: ${name}`)
      }
    }
    await done
  } catch (error) {
    extract.destroy()
    await done.catch(() => undefined)
    throw error
  }
  if (manifestText === undefined || databaseSize === undefined) throw new Error('The snapshot is missing its manifest or database')
  const raw: unknown = JSON.parse(manifestText)
  if ((raw as { format?: unknown } | null)?.format === 'pulpo-instance-backup') {
    throw new Error(ALREADY_ARCHIVE)
  }
  return { manifest: backupSnapshotManifestSchema.parse(raw), databasePath, databaseSize }
}

/** Download, decrypt, and verify one stored blob into a private temporary file. */
async function stageBlob(source: BlobSource, identities: string[], blob: BackupSnapshotManifest['blobs'][number], path: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const hash = createHash('sha256')
      let size = 0
      await pipeline(await decryptStream(await openBlob(source, blob.storageKey), identities), new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length; hash.update(chunk); callback(null, chunk)
        },
      }), createWriteStream(path, { mode: 0o600 }))
      if (size !== blob.sizeBytes || hash.digest('hex') !== blob.checksum) throw new Error(`Blob ${blob.storageKey} failed its checksum`)
      return
    } catch (error) {
      if (attempt >= FETCH_ATTEMPTS || source.kind === 'directory') throw error
    }
  }
}

/**
 * Rebuild the self-contained archive that Pulpo's restore accepts. Everything
 * happens locally: the private identity never leaves this machine.
 */
export async function assembleSnapshot(options: AssembleOptions): Promise<AssembleResult> {
  const identities = await readIdentities(options.identityPath)
  if (await stat(options.outputPath).then(() => true, () => false)) {
    throw Object.assign(new Error(`${options.outputPath} already exists`), { code: 'EEXIST' })
  }
  // Write beside the destination and publish only a complete archive, so an
  // interrupted run never leaves a truncated file under the requested name.
  const partialPath = join(dirname(options.outputPath), `.${basename(options.outputPath)}.${randomUUID()}.partial`)
  const directory = await mkdtemp(join(tmpdir(), 'pulpo-assemble-'))
  const output = await open(partialPath, 'wx', 0o600).catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true })
    throw error
  })
  const pack = tar.pack()
  const written = pipeline(pack, createGzip(), output.createWriteStream())
  void written.catch(() => undefined)
  try {
    const { manifest, databasePath, databaseSize } = await readSnapshot(options.snapshotPath, identities, directory)
    const groups = new Map<string, BackupSnapshotManifest['blobs']>()
    for (const blob of manifest.blobs) {
      const group = groups.get(blob.storageKey) ?? []
      const first = group[0]
      if (first && (first.checksum !== blob.checksum || first.sizeBytes !== blob.sizeBytes)) throw new Error(`Conflicting manifest entries for ${blob.storageKey}`)
      groups.set(blob.storageKey, [...group, blob])
    }
    const stored = [...groups.values()]
    const staged: Array<Promise<string> | undefined> = []
    const prefetch = (index: number): Promise<string> => {
      const existing = staged[index]
      if (existing) return existing
      const path = join(directory, `blob-${index}`)
      const pending = stageBlob(options.blobs, identities, stored[index]![0]!, path).then(() => path)
      void pending.catch(() => undefined)
      staged[index] = pending
      return pending
    }
    const addEntry = (name: string, body: Readable, size: number) => pipeline(body, pack.entry({ name, size, mode: 0o600 }))

    await addEntry('database.json', createReadStream(databasePath), databaseSize)
    await rm(databasePath)
    const entries: Array<{ entry: string; objectKey: string; checksum: string }> = []
    for (const [index, blobs] of stored.entries()) {
      for (let ahead = index; ahead < Math.min(stored.length, index + PREFETCH); ahead++) void prefetch(ahead).catch(() => undefined)
      const path = await prefetch(index)
      for (const blob of blobs) {
        const entry = `blobs/${Buffer.from(blob.objectKey).toString('base64url')}`
        await addEntry(entry, createReadStream(path), blob.sizeBytes)
        entries.push({ entry, objectKey: blob.objectKey, checksum: blob.checksum })
      }
      await rm(path)
      options.onProgress?.(index + 1, stored.length)
    }
    const archiveManifest = { format: 'pulpo-instance-backup', version: 1, createdAt: manifest.createdAt, tables: manifest.tables, blobs: entries }
    await addEntry('manifest.json', Readable.from([Buffer.from(JSON.stringify(archiveManifest))]), Buffer.byteLength(JSON.stringify(archiveManifest)))
    pack.finalize()
    await written
    await publish(partialPath, options.outputPath)
    return {
      createdAt: manifest.createdAt, blobs: manifest.blobs.length, storedObjects: stored.length,
      outputPath: options.outputPath, sizeBytes: (await stat(options.outputPath)).size,
    }
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error('Assembly failed'))
    await written.catch(() => undefined)
    await output.close().catch(() => undefined)
    throw error
  } finally {
    await rm(partialPath, { force: true })
    await rm(directory, { recursive: true, force: true })
  }
}

/** Move a finished file into place without ever replacing an existing one. */
async function publish(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination)
  } catch (error) {
    // Some removable-drive filesystems have no hard links; an exclusive copy is equally safe.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error
    await copyFile(source, destination, constants.COPYFILE_EXCL)
  }
}
