import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { modelImageRendition } from './model-image.js'

describe('model image renditions', () => {
  it('bakes EXIF rotation into full-resolution JPEG pixels', async () => {
    const source = await sharp({
      create: { width: 1_200, height: 800, channels: 3, background: '#8b5cf6' },
    }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer()

    const rendition = await modelImageRendition(source, 'image/jpeg')
    const metadata = await sharp(rendition.data).metadata()

    expect(rendition.normalized).toBe(true)
    expect(rendition.mimeType).toBe('image/jpeg')
    expect(metadata.width).toBe(800)
    expect(metadata.height).toBe(1_200)
    expect(metadata.orientation).toBeUndefined()
  })

  it('applies mirrored EXIF orientations without resizing the raster', async () => {
    const source = await sharp(Buffer.from([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]), {
      raw: { width: 2, height: 1, channels: 4 },
    }).png().withMetadata({ orientation: 2 }).toBuffer()

    const rendition = await modelImageRendition(source, 'image/png')
    const metadata = await sharp(rendition.data).metadata()
    const pixels = await sharp(rendition.data).raw().toBuffer()

    expect(rendition.normalized).toBe(true)
    expect(rendition.mimeType).toBe('image/png')
    expect(metadata.width).toBe(2)
    expect(metadata.height).toBe(1)
    expect(metadata.orientation).toBeUndefined()
    expect([...pixels]).toEqual([
      0, 0, 255, 255,
      255, 0, 0, 255,
    ])
  })

  it('passes already-normalized images through byte-for-byte', async () => {
    const source = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#f97316' },
    }).jpeg({ quality: 95 }).toBuffer()

    const rendition = await modelImageRendition(source, 'image/jpeg')

    expect(rendition.normalized).toBe(false)
    expect(rendition.data).toEqual(source)
  })

  it('preserves malformed image pass-through behavior', async () => {
    const source = Buffer.from('not actually an image')

    const rendition = await modelImageRendition(source, 'image/png')

    expect(rendition.normalized).toBe(false)
    expect(rendition.data).toEqual(source)
  })
})
