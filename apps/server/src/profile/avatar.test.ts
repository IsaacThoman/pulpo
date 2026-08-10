import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { normalizeProfileAvatar, PROFILE_AVATAR_MAX_BYTES } from './avatar.js'

describe('profile avatar processing', () => {
  it('center-crops and normalizes supported images to 512px WebP', async () => {
    const source = await sharp({
      create: { width: 900, height: 450, channels: 4, background: { r: 20, g: 80, b: 180, alpha: 1 } },
    }).png().toBuffer()
    const output = await normalizeProfileAvatar(source, 'image/png')
    expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 })
  })

  it('rejects unsupported, malformed, and oversized files', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).gif().toBuffer()
    await expect(normalizeProfileAvatar(gif, 'image/gif')).rejects.toThrow('JPEG, PNG, or WebP')
    await expect(normalizeProfileAvatar(new TextEncoder().encode('bad'), 'image/png')).rejects.toThrow()
    await expect(normalizeProfileAvatar(new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1), 'image/png')).rejects.toThrow('5 MiB')
  })
})
