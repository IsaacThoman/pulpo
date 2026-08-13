import { describe, expect, it } from 'vitest'
import { avatarDrawRect, DEFAULT_AVATAR_CROP } from './avatar-crop'

describe('avatar crop geometry', () => {
  it('covers the canvas and clamps crop offsets', () => {
    expect(avatarDrawRect(1000, 500, DEFAULT_AVATAR_CROP)).toEqual({ x: -256, y: 0, width: 1024, height: 512 })
    expect(avatarDrawRect(1000, 500, { ...DEFAULT_AVATAR_CROP, offsetX: 999 })).toEqual({ x: 0, y: 0, width: 1024, height: 512 })
  })

  it('contains the full image when cropping is disabled', () => {
    expect(avatarDrawRect(1000, 500, { ...DEFAULT_AVATAR_CROP, cropToCircle: false, zoom: 3, offsetX: 100 })).toEqual({
      x: 0,
      y: 128,
      width: 512,
      height: 256,
    })
  })
})
