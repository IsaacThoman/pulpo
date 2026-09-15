import { readFile } from 'node:fs/promises'
import { randomFillSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalizeImageReference, validateImageBytes } from './provider.js'

const allowed = ['image/jpeg', 'image/png', 'image/webp']
const normalize = (data: Uint8Array, signal = new AbortController().signal) => normalizeImageReference({ data, mimeType: 'untrusted/type' }, allowed, signal)

describe('reference image normalization', () => {
  it('strips the second MPO image and metadata, applies orientation, and preserves the original', async () => {
    const original = await readFile(new URL('./fixtures/oriented-mpo.jpg', import.meta.url))
    expect(await validateImageBytes(original)).toBe('image/jpeg') // The previous validation alone allowed this container.
    expect(original.includes(Buffer.from('MPF\0'))).toBe(true)
    const { data, mimeType } = await normalize(original)
    const encoded = Buffer.from(data)
    const metadata = await sharp(data).metadata()
    expect(mimeType).toBe('image/jpeg')
    expect(metadata).toMatchObject({ format: 'jpeg', width: 32, height: 64, space: 'srgb' })
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(metadata.gainMap).toBeUndefined()
    expect(encoded.includes(Buffer.from('MPF\0'))).toBe(false)
    expect(encoded.toString('hex').match(/ffd8ff/g)).toHaveLength(1)
    const pixels = await sharp(data).raw().toBuffer()
    expect(pixels[0]).toBeGreaterThan(240) // Left red half becomes the top half after EXIF rotation.
    expect(pixels[2]).toBeLessThan(10)
    expect(pixels[pixels.length - 3]).toBeLessThan(10)
    expect(pixels[pixels.length - 1]).toBeGreaterThan(240)
    expect(original).toEqual(await readFile(new URL('./fixtures/oriented-mpo.jpg', import.meta.url)))
  })

  it.each(['png', 'webp'] as const)('preserves %s transparency and pixels while removing metadata', async format => {
    const original = await sharp({ create: { width: 8, height: 4, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 0.5 } } })
      .withExif({ IFD0: { Artist: 'synthetic-private-metadata' } }).toFormat(format).toBuffer()
    const { data, mimeType } = await normalize(original)
    expect(mimeType).toBe(`image/${format}`)
    const metadata = await sharp(data).metadata()
    expect(metadata).toMatchObject({ width: 8, height: 4, hasAlpha: true })
    expect(metadata.exif).toBeUndefined()
    expect(await sharp(data).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer())
  })

  it('rejects corrupt files, animations and excessive pixel/byte counts', async () => {
    const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#123' } }).png().toBuffer()
    const frames = Buffer.alloc(2 * 4 * 4, 200)
    frames.fill(40, 0, 2 * 2 * 4)
    const animated = await sharp(frames, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ loop: 0 }).toBuffer()
    expect((await sharp(animated).metadata()).pages).toBe(2)
    const oversized = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: '#123' } }).png().toBuffer()
    for (const data of [Buffer.from('not an image'), png.subarray(0, 40), animated, oversized, Buffer.alloc(21 * 1024 * 1024)]) {
      await expect(normalize(data)).rejects.toThrow()
    }
  })

  it('enforces the byte limit again when lossless normalization expands a compressed input', async () => {
    const data = await sharp(randomFillSync(Buffer.alloc(3400 * 3000 * 3)), { raw: { width: 3400, height: 3000, channels: 3 } }).webp({ quality: 95 }).toBuffer()
    expect(data.length).toBeLessThan(20 * 1024 * 1024)
    await expect(normalize(data)).rejects.toThrow('Normalized reference image exceeds 20 MiB')
  }, 30_000)

  it('checks cancellation before decoding and while normalizing', async () => {
    await expect(normalize(Buffer.from('invalid'), AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    const data = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#123' } }).png().toBuffer()
    const controller = new AbortController()
    const result = normalize(data, controller.signal)
    const rejection = expect(result).rejects.toThrow('cancelled')
    setTimeout(() => controller.abort(new Error('cancelled')), 5)
    await rejection
  })
})
