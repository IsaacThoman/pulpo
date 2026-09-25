// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentPreviewDialog } from './AttachmentPreview'
import { MAX_TEXT_PREVIEW_CHARACTERS } from '@/lib/attachment-previews'
import { writeClipboardText } from '@/lib/clipboard'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
})
vi.mock('@/lib/clipboard', () => ({ writeClipboardText: vi.fn(async () => true) }))

afterEach(() => {
  cleanup()
  vi.mocked(writeClipboardText).mockClear()
})

function renderPreview(name: string, text: string) {
  // jsdom's File has no text(); the dialog reads previews through it.
  const file = Object.assign(new File([text], name, { type: 'text/plain' }), { text: async () => text })
  return render(
    <AttachmentPreviewDialog
      attachment={{ id: name, name, mimeType: 'text/plain', type: 'file', size: file.size }}
      sourceFile={file}
      open
      onOpenChange={() => undefined}
      onDownload={() => undefined}
    />,
  )
}

describe('attachment text previews', () => {
  it('copies the previewed file text', async () => {
    const view = renderPreview('kv_cache.py', 'import math\nprint(math.pi)\n')
    fireEvent.click(await view.findByRole('button', { name: 'Copy text' }))

    expect(writeClipboardText).toHaveBeenCalledWith('import math\nprint(math.pi)\n')
    expect(await view.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('does not offer to copy a truncated preview', async () => {
    const view = renderPreview('huge.log', 'x'.repeat(MAX_TEXT_PREVIEW_CHARACTERS + 10))
    await waitFor(() => expect(view.getByText(/Showing the first part of/)).toBeTruthy())

    expect(view.queryByRole('button', { name: 'Copy text' })).toBeNull()
  })
})
