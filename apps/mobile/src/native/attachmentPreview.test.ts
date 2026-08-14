import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ previewFile: vi.fn(async () => undefined) }))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: vi.fn(() => ({ previewFile: mocks.previewFile })),
}))

import { previewFile, supportsAttachmentPreview } from './attachmentPreview'

describe('attachment preview wrapper', () => {
  beforeEach(() => mocks.previewFile.mockClear())

  it('presents a local file through the optional Apple module', async () => {
    expect(supportsAttachmentPreview).toBe(true)
    await previewFile('file:///tmp/report.pdf', 'Quarterly report.pdf')
    expect(mocks.previewFile).toHaveBeenCalledWith('file:///tmp/report.pdf', 'Quarterly report.pdf')
  })
})
