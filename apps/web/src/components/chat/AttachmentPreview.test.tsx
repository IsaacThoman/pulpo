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

function renderPreview(name: string, text: string, mimeType = 'text/plain') {
  // jsdom's File has no text(); the dialog reads previews through it.
  const file = Object.assign(new File([text], name, { type: mimeType }), { text: async () => text })
  return render(
    <AttachmentPreviewDialog
      attachment={{ id: name, name, mimeType, type: 'file', size: file.size }}
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

describe('attachment table previews', () => {
  it('keeps the whole file and loads rows in batches', async () => {
    const lines = ['id,name', ...Array.from({ length: 450 }, (_, index) => `${index + 1},row ${index + 1}`)]
    const text = lines.join('\n')
    const view = renderPreview('big.csv', text, 'text/csv')

    expect(await view.findByText('200 rows loaded · 2 columns · scroll for more')).toBeTruthy()
    expect(view.getByText('name')).toBeTruthy()
    expect(view.queryByText(/Showing the first part of/)).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Copy text' }))
    expect(writeClipboardText).toHaveBeenCalledWith(text)
  })

  it('shows single-column files as text', async () => {
    const view = renderPreview('list.csv', 'one\ntwo', 'text/csv')
    await waitFor(() => expect(view.container.ownerDocument.querySelector('[data-preview-kind="text"]')).toBeTruthy())
  })
})
