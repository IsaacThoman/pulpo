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

  it('converts to WebP with full dimensions, alpha, and EXIF orientation intact', async () => {
    const source = await sharp({ create: { width: 120, height: 80, channels: 4, background: '#ff000080' } })
      .png().withMetadata({ orientation: 6 }).toBuffer()
    const rendition = await modelImageRendition(source, 'image/png', undefined, { convertImagesToWebp: true, webpQuality: 80 })
    expect(rendition.mimeType).toBe('image/webp')
    expect(await sharp(rendition.data).metadata()).toMatchObject({ format: 'webp', width: 80, height: 120, hasAlpha: true })
    expect((await sharp(rendition.data).metadata()).orientation).toBeUndefined()
    expect((await sharp(source).metadata()).orientation).toBe(6)
  })

  it('separates cached originals and quality variants and coalesces identical conversions', async () => {
    const pixels = Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 37 + Math.floor(i / 17)) % 256))
    const source = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer()
    const [low, high, repeated, original] = await Promise.all([
      modelImageRendition(source, 'image/png', 'quality-fixture', { convertImagesToWebp: true, webpQuality: 30 }),
      modelImageRendition(source, 'image/png', 'quality-fixture', { convertImagesToWebp: true, webpQuality: 90 }),
      modelImageRendition(source, 'image/png', 'quality-fixture', { convertImagesToWebp: true, webpQuality: 30 }),
      modelImageRendition(source, 'image/png', 'quality-fixture'),
    ])
    expect(low).toBe(repeated)
    expect(low.data.length).toBeLessThan(high.data.length)
    expect(original.data).toEqual(source)
    expect(original.mimeType).toBe('image/png')
    const defaults = await modelImageRendition(source, 'image/png', 'quality-fixture', { convertImagesToWebp: true })
    expect(defaults).toBe(await modelImageRendition(source, 'image/png', 'quality-fixture', { convertImagesToWebp: true, webpQuality: 80 }))
  })

  it('preserves animation when converting GIF to WebP', async () => {
    const pixels = Buffer.from([...Array(8 * 8).fill([255, 0, 0]).flat(), ...Array(8 * 8).fill([0, 0, 255]).flat()])
    const source = await sharp(pixels, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } })
      .gif({ delay: [100, 200], loop: 2 }).toBuffer()
    const rendition = await modelImageRendition(source, 'image/gif', undefined, { convertImagesToWebp: true })
    expect(rendition.mimeType).toBe('image/webp')
    expect(await sharp(rendition.data, { animated: true }).metadata()).toMatchObject({ pages: 2, pageHeight: 8, delay: [100, 200], loop: 2 })
  })

  it('passes malformed images through when WebP conversion cannot decode them', async () => {
    const source = Buffer.from('invalid png')
    expect(await modelImageRendition(source, 'image/png', undefined, { convertImagesToWebp: true }))
      .toEqual({ data: source, mimeType: 'image/png', normalized: false })
  })

})
