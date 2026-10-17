import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  contentUri: vi.fn(),
  launch: vi.fn(),
  previewFile: vi.fn(),
  previewWebDocument: vi.fn(),
  webPreviewSupported: { value: true },
}))
vi.mock('expo-file-system/legacy', () => ({ getContentUriAsync: mocks.contentUri }))
vi.mock('expo-intent-launcher', () => ({ startActivityAsync: mocks.launch }))
vi.mock('./attachmentPreview', () => {
  class AttachmentPreviewError extends Error {
    constructor(message: string, readonly code: string) { super(message) }
  }
  return {
    AttachmentPreviewError,
    previewFile: mocks.previewFile,
    previewWebDocument: mocks.previewWebDocument,
    get supportsWebDocumentPreview() { return mocks.webPreviewSupported.value },
  }
})
import { openAttachmentFile } from './openFile.android'
import { openAttachmentFile as openAppleAttachmentFile } from './openFile'
import { AttachmentPreviewError } from './attachmentPreview'

describe('Android file opening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contentUri.mockResolvedValue('content://pulpo/cache/report.pdf')
    mocks.launch.mockResolvedValue({ resultCode: 0 })
  })
  it('grants read access to the downloaded file without granting write access', async () => {
    await openAttachmentFile('file:///cache/report.pdf', 'Report', 'application/pdf')
    expect(mocks.launch).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://pulpo/cache/report.pdf', type: 'application/pdf', flags: 1,
    })
  })
  it('preserves content URIs and propagates missing viewer errors for the share fallback', async () => {
    mocks.launch.mockRejectedValue(new Error('No viewer'))
    await expect(openAttachmentFile('content://pulpo/report', 'Report')).rejects.toThrow('No viewer')
    expect(mocks.contentUri).not.toHaveBeenCalled()
  })
  it('does not send remote URLs or session credentials to another app', async () => {
    await expect(openAttachmentFile('https://pulpo.example/api/attachments/1', 'Report')).rejects.toThrow('Download')
    expect(mocks.launch).not.toHaveBeenCalled()
  })
})

describe('iOS file opening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.webPreviewSupported.value = true
    mocks.previewFile.mockResolvedValue(undefined)
    mocks.previewWebDocument.mockResolvedValue(undefined)
  })
  it('runs HTML attachments in the web preview instead of Quick Look', async () => {
    await openAppleAttachmentFile('file:///cache/quiz.html', 'quiz.html', 'text/html')
    await openAppleAttachmentFile('file:///cache/export', 'export', 'text/html')
    expect(mocks.previewWebDocument).toHaveBeenNthCalledWith(1, 'file:///cache/quiz.html', 'quiz.html')
    expect(mocks.previewWebDocument).toHaveBeenNthCalledWith(2, 'file:///cache/export', 'export')
    expect(mocks.previewFile).not.toHaveBeenCalled()
  })
  it('keeps other documents, including SVG and JSX source, in Quick Look', async () => {
    for (const name of ['report.pdf', 'logo.svg', 'App.jsx', 'notes.txt']) await openAppleAttachmentFile(`file:///cache/${name}`, name)
    expect(mocks.previewWebDocument).not.toHaveBeenCalled()
    expect(mocks.previewFile).toHaveBeenCalledTimes(4)
  })
  it('falls back to Quick Look on binaries without the web preview', async () => {
    mocks.webPreviewSupported.value = false
    await openAppleAttachmentFile('file:///cache/quiz.html', 'quiz.html', 'text/html')
    expect(mocks.previewWebDocument).not.toHaveBeenCalled()
    expect(mocks.previewFile).toHaveBeenCalledWith('file:///cache/quiz.html', 'quiz.html')
  })
  it('shows pages too large to run as static Quick Look documents', async () => {
    mocks.previewWebDocument.mockRejectedValue(new AttachmentPreviewError('Too large', 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED'))
    await openAppleAttachmentFile('file:///cache/huge.html', 'huge.html', 'text/html')
    expect(mocks.previewFile).toHaveBeenCalledWith('file:///cache/huge.html', 'huge.html')
  })
  it('surfaces other web preview failures without opening Quick Look', async () => {
    mocks.previewWebDocument.mockRejectedValue(new AttachmentPreviewError('Busy', 'ERR_ATTACHMENT_PREVIEW_BUSY'))
    await expect(openAppleAttachmentFile('file:///cache/quiz.html', 'quiz.html')).rejects.toThrow('Busy')
    expect(mocks.previewFile).not.toHaveBeenCalled()
  })
})
