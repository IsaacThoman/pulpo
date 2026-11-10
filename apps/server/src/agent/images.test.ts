import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { detectImageMime, fitViewedImage, VIEWED_IMAGE_MAX_BYTES, VIEWED_IMAGE_MAX_EDGE } from './images.js'

/** Random pixels compress badly, like a detailed photo. */
function noise(width: number, height: number, channels: 3 | 4 = 3) {
  return sharp(randomBytes(width * height * channels), { raw: { width, height, channels } })
}

describe('agent image detection', () => {
  it.each([
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [Buffer.from('GIF89a', 'ascii'), 'image/gif'],
    [Buffer.from('RIFF0000WEBP', 'ascii'), 'image/webp'],
  ])('recognizes supported image bytes', (bytes, expected) => {
    expect(detectImageMime(bytes)).toBe(expected)
  })

  it('rejects extensions and declared types without a supported signature', () => {
    expect(detectImageMime(Buffer.from('not really an image'))).toBeNull()
  })
})

describe('fitting viewed images to provider limits', () => {
  it('passes images within the limits through byte for byte', async () => {
    const png = await noise(800, 600).png().toBuffer()
    const fitted = await fitViewedImage(png, 'image/png')
    expect(fitted.data.equals(png)).toBe(true)
    expect(fitted).toMatchObject({ mimeType: 'image/png' })
    expect(fitted.resized).toBeUndefined()
  })

  it('shrinks a large phone photo below the edge and byte limits', async () => {
    const photo = await noise(4032, 3024).jpeg({ quality: 100 }).toBuffer()
    expect(photo.byteLength).toBeGreaterThan(VIEWED_IMAGE_MAX_BYTES)
    const fitted = await fitViewedImage(photo, 'image/jpeg')
    const metadata = await sharp(fitted.data).metadata()
    expect(fitted.mimeType).toBe('image/jpeg')
    expect(metadata.format).toBe('jpeg')
    expect(fitted.data.byteLength).toBeLessThanOrEqual(VIEWED_IMAGE_MAX_BYTES)
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(VIEWED_IMAGE_MAX_EDGE)
    expect(fitted.resized).toEqual({ fromWidth: 4032, fromHeight: 3024, width: metadata.width, height: metadata.height })
  }, 30_000)

  it('bakes in EXIF orientation and reports upright dimensions', async () => {
    const sideways = await noise(4000, 3000).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer()
    const fitted = await fitViewedImage(sideways, 'image/jpeg')
    const metadata = await sharp(fitted.data).metadata()
    expect(fitted.resized).toMatchObject({ fromWidth: 3000, fromHeight: 4000 })
    expect(metadata.height).toBeGreaterThan(metadata.width!)
    expect(metadata.orientation ?? 1).toBe(1)
  }, 30_000)

  it('keeps transparency by encoding oversized PNGs as WebP', async () => {
    const png = await noise(3200, 1800, 4).png().toBuffer()
    const fitted = await fitViewedImage(png, 'image/png')
    const metadata = await sharp(fitted.data).metadata()
    expect(fitted.mimeType).toBe('image/webp')
    expect(metadata.hasAlpha).toBe(true)
    expect(metadata.width).toBeLessThanOrEqual(VIEWED_IMAGE_MAX_EDGE)
    expect(fitted.data.byteLength).toBeLessThanOrEqual(VIEWED_IMAGE_MAX_BYTES)
  }, 30_000)

  it('leaves undecodable images to the provider', async () => {
    const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    expect(await fitViewedImage(corrupt, 'image/jpeg')).toEqual({ data: corrupt, mimeType: 'image/jpeg' })
  })
})
