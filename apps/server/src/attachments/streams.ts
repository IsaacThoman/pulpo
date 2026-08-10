import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

const MIME_PREFIX_BYTES = 16

export class AttachmentSizeMismatchError extends Error {
  constructor() {
    super('Uploaded size does not match the declared size')
    this.name = 'AttachmentSizeMismatchError'
  }
}

function byteChunk(value: unknown): Buffer {
  if (typeof value === 'string') return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('Attachment stream returned a non-byte chunk')
}

async function* exactSizeChunks(source: AsyncIterable<unknown>, expectedBytes: number): AsyncGenerator<Buffer> {
  let sizeBytes = 0
  for await (const value of source) {
    const chunk = byteChunk(value)
    sizeBytes += chunk.byteLength
    if (sizeBytes > expectedBytes) throw new AttachmentSizeMismatchError()
    yield chunk
  }
  if (sizeBytes !== expectedBytes) throw new AttachmentSizeMismatchError()
}

export function exactSizeStream(source: AsyncIterable<unknown>, expectedBytes: number): Readable {
  return Readable.from(exactSizeChunks(source, expectedBytes), { objectMode: false })
}

export async function inspectAttachmentStream(source: AsyncIterable<unknown>, expectedBytes: number): Promise<{
  checksum: string
  prefix: Uint8Array
}> {
  const hash = createHash('sha256')
  const prefixChunks: Buffer[] = []
  let prefixBytes = 0
  let sizeBytes = 0
  for await (const value of source) {
    const chunk = byteChunk(value)
    sizeBytes += chunk.byteLength
    if (sizeBytes > expectedBytes) throw new AttachmentSizeMismatchError()
    hash.update(chunk)
    if (prefixBytes < MIME_PREFIX_BYTES) {
      const prefix = chunk.subarray(0, MIME_PREFIX_BYTES - prefixBytes)
      prefixChunks.push(prefix)
      prefixBytes += prefix.byteLength
    }
  }
  if (sizeBytes !== expectedBytes) throw new AttachmentSizeMismatchError()
  return { checksum: hash.digest('base64url'), prefix: Buffer.concat(prefixChunks) }
}
