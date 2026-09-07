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

import { afterEach, vi } from 'vitest'
import { isGifAvatar, prepareAvatarFile, prepareAvatarUpload } from './avatar-crop'

afterEach(() => vi.unstubAllGlobals())

describe('avatar upload preparation', () => {
  it('sends original GIF bytes with crop metadata before the file', async () => {
    const file = new File(['GIF89a-original-frames'], 'avatar.gif', { type: 'image/gif' })
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const crop = { ...DEFAULT_AVATAR_CROP, zoom: 2, offsetX: 70 }
    const body = await prepareAvatarUpload(file, crop)
    expect([...body.keys()]).toEqual(['crop', 'file'])
    expect(JSON.parse(body.get('crop') as string)).toEqual(crop)
    const uploaded = body.get('file') as File
    expect(uploaded.type).toBe('image/gif')
    expect(await uploaded.text()).toBe(await file.text())
    expect(decode).not.toHaveBeenCalled()
  })

  it('recognizes GIFs when the file picker omits the MIME type', () => {
    expect(isGifAvatar(new File(['GIF89a'], 'picture.GIF'))).toBe(true)
    expect(isGifAvatar(new File(['png'], 'picture.png', { type: 'image/png' }))).toBe(false)
  })

  it.each([false, true])('prepares still images with circle=%s and the actual canvas MIME type', async (cropToCircle) => {
    const context = { beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), drawImage: vi.fn() }
    const bitmap = { width: 1000, height: 500, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context, toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })) }) })
    const file = new File(['source'], 'source.png', { type: 'image/png' })
    const settings = { ...DEFAULT_AVATAR_CROP, cropToCircle }
    const prepared = await prepareAvatarFile(file, settings)
    expect(context.clip).toHaveBeenCalledTimes(cropToCircle ? 1 : 0)
    const rect = avatarDrawRect(bitmap.width, bitmap.height, settings)
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, rect.x, rect.y, rect.width, rect.height)
    expect(prepared.type).toBe('image/png')
    expect(prepared.name).toBe('avatar.png')
    expect(bitmap.close).toHaveBeenCalledOnce()
    const body = await prepareAvatarUpload(file, settings)
    expect([...body.keys()]).toEqual(['file'])
  })
})
