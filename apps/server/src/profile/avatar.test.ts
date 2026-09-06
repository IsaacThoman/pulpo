import sharp from 'sharp'
import { DEFAULT_AVATAR_CROP } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { normalizeProfileAvatar, parseProfileAvatarCrop, PROFILE_AVATAR_MAX_BYTES } from './avatar.js'

async function animation(loop = 0, pages = 2, width = 80, height = 40): Promise<Buffer> {
  const frames = []
  for (let page = 0; page < pages; page++) {
    frames.push(await sharp({ create: { width, height, channels: 4, background: page % 2 ? 'blue' : 'red' } }).raw().toBuffer())
  }
  return sharp(Buffer.concat(frames), { raw: { width, height: height * pages, channels: 4, pageHeight: height } })
    .gif({ loop, delay: Array.from({ length: pages }, (_, page) => page % 2 ? 230 : 70) }).toBuffer()
}

async function pixels(image: Buffer) {
  const { data, info } = await sharp(image, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return (x: number, y: number, page = 0) => [...data.subarray(((page * 512 + y) * info.width + x) * 4, ((page * 512 + y) * info.width + x) * 4 + 4)]
}

describe('profile avatar processing', () => {
  it('keeps legacy center-cropping for uploads without crop settings', async () => {
    const source = await sharp({ create: { width: 900, height: 450, channels: 4, background: 'red' } }).png().toBuffer()
    const output = await normalizeProfileAvatar(source, 'image/png')
    expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 })
    expect((await pixels(output))(0, 0)[3]).toBe(255)
  })

  it.each([false, true])('applies a still-image crop with circle=%s', async (cropToCircle) => {
    const source = await sharp({ create: { width: 900, height: 450, channels: 4, background: 'red' } }).png().toBuffer()
    const output = await normalizeProfileAvatar(source, 'image/png', { ...DEFAULT_AVATAR_CROP, cropToCircle })
    const pixel = await pixels(output)
    expect(pixel(0, 0)[3]).toBe(0)
    expect(pixel(0, 128)[3]).toBe(cropToCircle ? 0 : 255)
    expect(pixel(256, 256)[3]).toBe(255)
  })

  it.each([0, 3])('preserves distinct frames, delays, and loop=%s', async (loop) => {
    const output = await normalizeProfileAvatar(await animation(loop), 'image/gif')
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({
      format: 'webp', width: 512, height: 1024, pageHeight: 512, pages: 2, delay: [70, 230], loop,
    })
    const pixel = await pixels(output)
    expect(pixel(256, 256, 0)[0]).toBeGreaterThan(240)
    expect(pixel(256, 256, 1)[2]).toBeGreaterThan(240)
  })

  it.each([false, true])('preserves GIF animation with circle=%s', async (cropToCircle) => {
    const output = await normalizeProfileAvatar(await animation(), 'image/gif', { ...DEFAULT_AVATAR_CROP, cropToCircle })
    const pixel = await pixels(output)
    for (const page of [0, 1]) {
      expect(pixel(0, 0, page)[3]).toBe(0)
      expect(pixel(0, 128, page)[3]).toBe(cropToCircle ? 0 : 255)
      expect(pixel(256, 256, page)[3]).toBe(255)
    }
    expect(pixel(256, 256, 0)[0]).toBeGreaterThan(240)
    expect(pixel(256, 256, 1)[2]).toBeGreaterThan(240)
  })

  it('preserves all four corners of uncropped square images', async () => {
    const source = await sharp({ create: { width: 40, height: 40, channels: 4, background: 'red' } }).gif().toBuffer()
    const output = await normalizeProfileAvatar(source, 'image/gif', { ...DEFAULT_AVATAR_CROP, cropToCircle: false })
    const pixel = await pixels(output)
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) expect(pixel(x!, y!)[3]).toBe(255)
  })

  it('zooms, repositions, and clamps the crop identically on every frame', async () => {
    const frame = await sharp({ create: { width: 80, height: 40, channels: 4, background: 'red' } })
      .composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 4, background: 'blue' } }).png().toBuffer(), left: 40, top: 0 }])
      .raw().toBuffer()
    const source = await sharp(frame, { raw: { width: 80, height: 40, channels: 4 } }).gif().toBuffer()
    for (const offsetX of [-9999, 9999]) {
      const output = await normalizeProfileAvatar(source, 'image/gif', { ...DEFAULT_AVATAR_CROP, zoom: 3, offsetX, offsetY: 9999 })
      const pixel = await pixels(output)
      expect(pixel(256, 256)[offsetX > 0 ? 0 : 2]).toBeGreaterThan(240)
      expect(pixel(0, 0)[3]).toBe(0)
    }
  })

  it('retains transparency and resolves partial GIF frames without ghosting', async () => {
    const frames = []
    for (const left of [0, 20, 40]) {
      frames.push(await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp({ create: { width: 20, height: 20, channels: 4, background: 'red' } }).png().toBuffer(), left, top: 10 }])
        .raw().toBuffer())
    }
    const gif = await sharp(Buffer.concat(frames), { raw: { width: 80, height: 120, channels: 4, pageHeight: 40 } })
      .gif({ delay: [70, 120, 230], loop: 2 }).toBuffer()
    const output = await normalizeProfileAvatar(gif, 'image/gif', { ...DEFAULT_AVATAR_CROP, cropToCircle: false })
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 3, delay: [70, 120, 230], loop: 2 })
    const pixel = await pixels(output)
    for (const page of [0, 1, 2]) {
      for (const position of [0, 1, 2]) expect(pixel(position * 128 + 64, 256, page)[3]).toBe(page === position ? 255 : 0)
    }
  })

  it('rejects unsupported, malformed, and oversized files', async () => {
    await expect(normalizeProfileAvatar(Buffer.from('<svg/>'), 'image/svg+xml')).rejects.toThrow('JPEG, PNG, WebP, or GIF')
    await expect(normalizeProfileAvatar(Buffer.from('bad'), 'image/gif')).rejects.toThrow()
    await expect(normalizeProfileAvatar(new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1), 'image/gif')).rejects.toThrow('5 MiB')
    await expect(normalizeProfileAvatar(await animation(0, 101, 1, 1), 'image/gif')).rejects.toThrow('100 frames')
    const hugeGif = await animation(0, 2, 4000, 3200)
    await expect(normalizeProfileAvatar(hugeGif, 'image/gif')).rejects.toThrow(/pixel/i)
  })
})

describe('profile crop validation', () => {
  it('accepts valid crops and absent legacy settings', () => {
    expect(parseProfileAvatarCrop()).toBeUndefined()
    expect(parseProfileAvatarCrop(JSON.stringify(DEFAULT_AVATAR_CROP))).toEqual(DEFAULT_AVATAR_CROP)
  })
  it.each(['bad', 'null', '[]', '{}', '{"cropToCircle":true,"zoom":1,"offsetX":1e999,"offsetY":0}',
    ...[{ cropToCircle: 'false' }, { zoom: 0 }, { zoom: 4 }, { offsetY: null }].map((value) => JSON.stringify({ ...DEFAULT_AVATAR_CROP, ...value })),
  ])('rejects malformed crop settings: %s', (value) => {
    expect(() => parseProfileAvatarCrop(value)).toThrow('Invalid profile picture crop')
  })
})
