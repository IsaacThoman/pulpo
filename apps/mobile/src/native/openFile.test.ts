import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ contentUri: vi.fn(), launch: vi.fn() }))
vi.mock('expo-file-system/legacy', () => ({ getContentUriAsync: mocks.contentUri }))
vi.mock('expo-intent-launcher', () => ({ startActivityAsync: mocks.launch }))
import { openAttachmentFile } from './openFile.android'

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
