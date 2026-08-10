import sharp from 'sharp'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createAttachmentThumbnail } from './thumbnail.js'

describe('attachment thumbnails', () => {
  it('creates a bounded WebP preview without enlarging the source', async () => {
    const source = await sharp({
      create: { width: 1_200, height: 800, channels: 3, background: '#8b5cf6' },
    }).png().toBuffer()

    const thumbnail = await createAttachmentThumbnail(source)
    const metadata = await sharp(thumbnail).metadata()

    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBeLessThanOrEqual(512)
    expect(thumbnail.byteLength).toBeLessThan(source.byteLength)
  })

  it('streams the source image into the thumbnail pipeline', async () => {
    const source = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#0ea5e9' },
    }).png().toBuffer()
    const thumbnail = await createAttachmentThumbnail(Readable.from(source, { objectMode: false }))
    expect((await sharp(thumbnail).metadata()).format).toBe('webp')
  })
})
