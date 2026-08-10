import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AttachmentSizeMismatchError, exactSizeStream, inspectAttachmentStream } from './streams.js'

async function bytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

describe('attachment streams', () => {
  it('passes a stream with the declared size without buffering it as one value', async () => {
    const stream = exactSizeStream(Readable.from([Buffer.from('hello'), Buffer.from(' world')]), 11)
    expect((await bytes(stream)).toString()).toBe('hello world')
  })

  it('rejects streams shorter or longer than the declared size', async () => {
    await expect(bytes(exactSizeStream(Readable.from([Buffer.from('short')]), 6))).rejects.toBeInstanceOf(AttachmentSizeMismatchError)
    await expect(bytes(exactSizeStream(Readable.from([Buffer.from('too long')]), 7))).rejects.toBeInstanceOf(AttachmentSizeMismatchError)
  })

  it('computes a checksum and bounded MIME prefix while streaming', async () => {
    const body = Buffer.from('streamed attachment contents')
    const inspected = await inspectAttachmentStream(Readable.from([body.subarray(0, 5), body.subarray(5)]), body.byteLength)
    expect(inspected.checksum).toBe(createHash('sha256').update(body).digest('base64url'))
    expect(Buffer.from(inspected.prefix)).toEqual(body.subarray(0, 16))
  })
})
