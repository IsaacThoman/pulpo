import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

type Stamp = { checksum: string; size: number; mtimeMs: number; ctimeMs: number; ino: number }

/** Lives with the workspace's daemon; a restart safely causes one fresh staging pass. */
export class StagedFiles {
  private files = new Map<string, Stamp>()
  async record(path: string, checksum: string): Promise<void> {
    const metadata = await stat(path)
    this.files.set(path, { checksum, size: metadata.size, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs, ino: metadata.ino })
  }
  async matches(path: string, checksum: string | null, size: number): Promise<boolean> {
    const stamp = this.files.get(path)
    if (!checksum || !stamp || stamp.checksum !== checksum || stamp.size !== size) return false
    try {
      const metadata = await lstat(path)
      return metadata.isFile() && metadata.size === stamp.size && metadata.mtimeMs === stamp.mtimeMs
        && metadata.ctimeMs === stamp.ctimeMs && metadata.ino === stamp.ino
    } catch { return false }
  }
}

export interface WriteStreamToFileOptions {
  expectedBytes: number
  maxBytes: number
  /** base64url sha256 the caller expects; the write fails when it does not match. */
  checksum?: string | null
  stagedFiles?: StagedFiles
}

/** Stream bytes to `target` through a temporary sibling, verifying size and checksum before the atomic rename. */
export async function writeStreamToFile(source: Readable, target: string, options: WriteStreamToFileOptions): Promise<{ digest: string }> {
  const { expectedBytes, maxBytes } = options
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes) {
    throw new Error('File size is missing or exceeds the workspace limit')
  }
  const temporary = `${target}.${randomUUID()}.upload`
  const hash = createHash('sha256')
  let sizeBytes = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      sizeBytes += chunk.byteLength
      callback(sizeBytes <= expectedBytes ? null : new Error('Uploaded file size does not match'), chunk)
    },
    flush(callback) {
      callback(sizeBytes === expectedBytes ? null : new Error('Uploaded file size does not match'))
    },
  })
  await mkdir(dirname(target), { recursive: true })
  try {
    await pipeline(source, meter, createWriteStream(temporary, { flags: 'wx' }))
    const digest = hash.digest('base64url')
    if (options.checksum && options.checksum !== digest) throw new Error('Uploaded file checksum does not match')
    await rename(temporary, target)
    await options.stagedFiles?.record(target, digest)
    return { digest }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function assertRegularFileWithin(path: string, maxBytes: number, label: string): Promise<number> {
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error(`${label} path must be a regular file`)
  if (metadata.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte limit`)
  return metadata.size
}
