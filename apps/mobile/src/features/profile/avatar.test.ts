import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
}))
vi.mock('expo-image-picker', () => ({
  ...mocks,
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}))
vi.mock('expo-file-system', () => ({
  File: class extends Blob { constructor(readonly uri: string) { super(['image']) } },
}))

import { avatarCandidate, avatarSizeError, avatarUploadBody, AvatarCameraPermissionError, AVATAR_PICKER_OPTIONS, pickAvatar } from './avatar'

beforeEach(() => vi.clearAllMocks())

describe('avatar candidates', () => {
  it('keeps types the server accepts and infers the rest from the file', () => {
    expect(avatarCandidate({ uri: 'file:///a.png', mimeType: 'image/png', fileSize: 10 })).toEqual({ uri: 'file:///a.png', name: 'avatar.png', mimeType: 'image/png', size: 10 })
    expect(avatarCandidate({ uri: 'file:///crop.WEBP' }).mimeType).toBe('image/webp')
    expect(avatarCandidate({ uri: 'file:///photo.heic', mimeType: 'image/heic' })).toMatchObject({ mimeType: 'image/jpeg', name: 'avatar.jpg' })
  })

  it('refuses photos over the server limit with its copy', () => {
    expect(avatarSizeError({ uri: 'a', name: 'avatar.jpg', mimeType: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull()
    expect(avatarSizeError({ uri: 'a', name: 'avatar.jpg', mimeType: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBe('Profile pictures may be at most 5 MiB')
  })
})

describe('picking an avatar', () => {
  it('opens Photos with the square system crop', async () => {
    mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///crop.jpg', mimeType: 'image/jpeg', fileSize: 42 }] })
    await expect(pickAvatar('library')).resolves.toEqual({ uri: 'file:///crop.jpg', name: 'avatar.jpg', mimeType: 'image/jpeg', size: 42 })
    expect(mocks.launchImageLibraryAsync).toHaveBeenCalledWith(AVATAR_PICKER_OPTIONS)
    expect(AVATAR_PICKER_OPTIONS).toMatchObject({ allowsEditing: true, aspect: [1, 1], mediaTypes: ['images'] })
  })

  it('resolves null when cancelled', async () => {
    mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null })
    await expect(pickAvatar('library')).resolves.toBeNull()
  })

  it('asks for the camera first and reports a refusal', async () => {
    mocks.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false })
    const error = await pickAvatar('camera').catch((next: unknown) => next)
    expect(error).toBeInstanceOf(AvatarCameraPermissionError)
    expect((error as AvatarCameraPermissionError).canAskAgain).toBe(false)
    expect(mocks.launchCameraAsync).not.toHaveBeenCalled()

    mocks.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true })
    mocks.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///camera.jpg' }] })
    await expect(pickAvatar('camera')).resolves.toMatchObject({ uri: 'file:///camera.jpg' })
    expect(mocks.launchCameraAsync).toHaveBeenCalledWith(AVATAR_PICKER_OPTIONS)
  })
})

describe('avatar upload body', () => {
  it('sends the default circle crop before the typed image file', () => {
    const body = avatarUploadBody({ uri: 'file:///crop.png', name: 'avatar.png', mimeType: 'image/png' })
    const entries = [...body.entries()]
    expect(entries.map(([key]) => key)).toEqual(['crop', 'file'])
    expect(JSON.parse(entries[0]![1] as string)).toEqual({ cropToCircle: true, zoom: 1, offsetX: 0, offsetY: 0 })
    const file = entries[1]![1] as File
    expect(file.name).toBe('avatar.png')
    expect(file.type).toBe('image/png')
  })
})
