import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  animateImageTransition: vi.fn(async () => undefined),
  previewImages: vi.fn(async () => undefined),
  previewFile: vi.fn(async () => undefined),
}))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: vi.fn(() => ({
    animateImageTransition: mocks.animateImageTransition,
    previewImages: mocks.previewImages,
    previewFile: mocks.previewFile,
  })),
}))

import {
  animateImageTransition,
  previewFile,
  previewImages,
  supportsAttachmentPreview,
  supportsNativeImageGallery,
  supportsNativeImageTransition,
} from './attachmentPreview'

describe('attachment preview wrapper', () => {
  beforeEach(() => {
    mocks.animateImageTransition.mockClear()
    mocks.previewImages.mockClear()
    mocks.previewFile.mockClear()
  })

  it('presents a local file through the optional Apple module', async () => {
    expect(supportsAttachmentPreview).toBe(true)
    expect(supportsNativeImageTransition).toBe(true)
    expect(supportsNativeImageGallery).toBe(true)
    await previewFile('file:///tmp/report.pdf', 'Quarterly report.pdf')
    expect(mocks.previewFile).toHaveBeenCalledWith('file:///tmp/report.pdf', 'Quarterly report.pdf')
  })

  it('runs the native image transition with measured frames', async () => {
    const from = { x: 10, y: 20, width: 112, height: 112, cornerRadius: 16 }
    const to = { x: 0, y: 200, width: 390, height: 220, cornerRadius: 0 }
    await expect(animateImageTransition('file:///tmp/photo.jpg', from, to, true)).resolves.toBe(true)
    expect(mocks.animateImageTransition).toHaveBeenCalledWith('file:///tmp/photo.jpg', from, to, true)
  })

  it('presents a native image gallery at the selected item', async () => {
    const items = [
      {
        id: 'photo-1',
        sourceNativeId: 'pulpo-attachment-preview-photo-1',
        title: 'Photo.jpg',
        uri: 'file:///tmp/photo.jpg',
      },
      {
        id: 'photo-2',
        sourceNativeId: 'pulpo-attachment-preview-photo-2',
        title: 'Another photo.jpg',
        uri: 'file:///tmp/another-photo.jpg',
      },
    ]
    const source = { x: 10, y: 20, width: 112, height: 112, cornerRadius: 16 }
    await previewImages(items, 1, source)
    expect(mocks.previewImages).toHaveBeenCalledWith(items, 1, source)
  })

  it('normalizes a wrapped native busy error without exposing internals', async () => {
    mocks.previewImages.mockRejectedValueOnce(new Error('FunctionCallException caused by AttachmentPreviewBusy'))
    const result = previewImages([{ id: 'photo-1', title: 'Photo.jpg', uri: 'file:///tmp/photo.jpg' }], 0)
    await expect(result).rejects.toMatchObject({
      code: 'ERR_ATTACHMENT_PREVIEW_BUSY',
      message: 'Another preview is already open.',
    })
  })
})
