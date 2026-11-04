import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveImageToPhotos: vi.fn(async () => undefined),
  exportFile: vi.fn(async () => true),
}))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: vi.fn(() => ({ copyFile: vi.fn(), ...mocks })),
}))

import { saveFileToDevice, saveImageToPhotos, supportsSaveToDevice, supportsSaveToPhotos } from './fileSaving'

describe('iOS file saving', () => {
  beforeEach(() => {
    mocks.saveImageToPhotos.mockClear()
    mocks.exportFile.mockClear()
  })

  it('saves images to Photos through the native module', async () => {
    expect(supportsSaveToPhotos).toBe(true)
    await saveImageToPhotos('file:///tmp/cat.png')
    expect(mocks.saveImageToPhotos).toHaveBeenCalledWith('file:///tmp/cat.png')
  })

  it('exports a copy under the attachment name and reports cancellation', async () => {
    expect(supportsSaveToDevice).toBe(true)
    await expect(saveFileToDevice('file:///tmp/cache/report.pdf', 'Q3 report.pdf')).resolves.toBe(true)
    expect(mocks.exportFile).toHaveBeenCalledWith('file:///tmp/cache/report.pdf', 'Q3 report.pdf')
    mocks.exportFile.mockResolvedValueOnce(false)
    await expect(saveFileToDevice('file:///tmp/cache/report.pdf', 'Q3 report.pdf')).resolves.toBe(false)
  })
})
