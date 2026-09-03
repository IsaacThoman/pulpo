import { describe, expect, it, vi } from 'vitest'
import { prepareDesktopDownload } from './downloads'

function downloadItem(filename = 'report.pdf') {
  return {
    cancel: vi.fn(),
    getFilename: vi.fn(() => filename),
    setSaveDialogOptions: vi.fn(),
  }
}

describe('desktop downloads', () => {
  it('uses Electron\'s native download dialog without pausing the item', () => {
    const item = downloadItem('quarterly report.pdf')

    prepareDesktopDownload(item, true)

    expect(item.setSaveDialogOptions).toHaveBeenCalledWith({
      defaultPath: 'quarterly report.pdf',
    })
    expect(item.cancel).not.toHaveBeenCalled()
  })

  it('cancels downloads started by untrusted renderers', () => {
    const item = downloadItem()

    prepareDesktopDownload(item, false)

    expect(item.cancel).toHaveBeenCalledOnce()
    expect(item.setSaveDialogOptions).not.toHaveBeenCalled()
  })
})
