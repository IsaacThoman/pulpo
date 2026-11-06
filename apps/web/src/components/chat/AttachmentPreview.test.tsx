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

function renderPreview(name: string, content: string | Uint8Array, mimeType = 'text/plain') {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  // jsdom's File has no text() or arrayBuffer(); the dialog reads previews through them.
  const file = Object.assign(new File([bytes as BlobPart], name, { type: mimeType }), {
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  })
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
    const view = renderPreview('huge.md', 'x'.repeat(MAX_TEXT_PREVIEW_CHARACTERS + 10), 'text/markdown')
    await waitFor(() => expect(view.getByText(/Showing the first part of/)).toBeTruthy())

    expect(view.queryByRole('button', { name: 'Copy text' })).toBeNull()
  })

  it('shows code in the code viewer with line numbers and find', async () => {
    const view = renderPreview('main.py', 'def total(items):\n    return sum(items)\n')
    await waitFor(() => expect(view.container.ownerDocument.querySelector('[data-preview-kind="code"]')).toBeTruthy())
    expect(view.getByRole('button', { name: 'Find' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Wrap lines' })).toBeTruthy()
  })

  it('reads text saved in a legacy Windows encoding', async () => {
    // "Café" in Windows-1252.
    const view = renderPreview('menu.txt', new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
    await waitFor(() => expect(view.container.ownerDocument.querySelector('[data-preview-kind="code"]')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Copy text' }))
    expect(writeClipboardText).toHaveBeenCalledWith('Café')
  })
})

describe('find in attachment previews', () => {
  it('closes the find bar on Escape without closing the preview', async () => {
    const view = renderPreview('main.py', 'print(1)\n')
    fireEvent.click(await view.findByRole('button', { name: 'Find' }))
    const input = view.getByRole('textbox', { name: 'Find' })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('search')).toBeNull())
    expect(view.getByTestId('attachment-preview-dialog')).toBeTruthy()
  })
})

describe('attachment notebook previews', () => {
  it('renders a notebook with its cells and outputs', async () => {
    const notebook = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
      cells: [
        { cell_type: 'markdown', metadata: {}, source: ['# Results'] },
        { cell_type: 'code', metadata: {}, execution_count: 3, source: ['print(41 + 1)'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['42\n'] }] },
      ],
    })
    const view = renderPreview('analysis.ipynb', notebook, 'application/x-ipynb+json')
    expect(await view.findByRole('heading', { name: 'Results' })).toBeTruthy()
    expect(view.getByText('42')).toBeTruthy()
    expect(view.getByText('[3]:')).toBeTruthy()
  })

  it('keeps JSON string values quoted and text output unquoted', async () => {
    const values = ['null', null, '{"id":1}', { id: 1 }, '', 'a"\n\\b']
    const notebook = JSON.stringify({ nbformat: 4, cells: [{ cell_type: 'code', source: '', outputs: [
      ...values.map((value) => ({ output_type: 'display_data', data: { 'application/json': value } })),
      { output_type: 'display_data', data: { 'text/plain': 'null' } },
    ] }] })
    const view = renderPreview('json-strings.ipynb', notebook)
    await waitFor(() => {
      const doc = view.container.ownerDocument
      expect([...doc.querySelectorAll('[data-output="json"]')].map((output) => output.textContent)).toEqual(values.map((value) => JSON.stringify(value, null, 2)))
      expect(doc.querySelector('[data-output="text"]')?.textContent).toBe('null')
    })
  })

  it('renders HTML in Markdown cells sanitized, keeping math', async () => {
    const notebook = JSON.stringify({
      nbformat: 4,
      cells: [{ cell_type: 'markdown', source: 'Line<br>with <b>bold</b> and $x^2$\n\n<div class="alert">Note</div>\n\n<img src=x onerror="alert(1)">\n\n<script>window.pwned = true</script>\n\n<a href="javascript:alert(1)">bad link</a>\n\n<picture><source srcset="https://tracker.example/p.png"><img src="https://tracker.example/i.png" alt="remote"></picture>\n\n<style>.markdown-content{display:none}</style>' }],
    })
    const view = renderPreview('cells.ipynb', notebook)
    const bold = await view.findByText('bold')
    expect(bold.tagName).toBe('B')
    const cell = view.container.ownerDocument.querySelector('[data-cell="markdown"]')!
    expect(cell.querySelector('br')).toBeTruthy()
    expect(cell.querySelector('.katex')).toBeTruthy()
    expect(cell.textContent).toContain('Note')
    expect(cell.querySelector('script')).toBeNull()
    expect(cell.innerHTML).not.toMatch(/onerror|javascript:|srcset|tracker\.example\/p/)
    // Remote images stay links the user can choose to open; nothing loads by itself.
    expect(cell.querySelector('img[src^="http"]')).toBeNull()
    expect(cell.querySelector('style')).toBeNull()
    expect(cell.textContent).not.toContain('display:none')
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })
})

describe('attachment table previews', () => {
  it('keeps the whole file and shows it as a grid', async () => {
    const lines = ['id,name', ...Array.from({ length: 450 }, (_, index) => `${index + 1},row ${index + 1}`)]
    const text = lines.join('\n')
    const view = renderPreview('big.csv', text, 'text/csv')

    expect(await view.findByText('451 rows · 2 columns')).toBeTruthy()
    expect(view.getByText('name')).toBeTruthy()
    expect(view.queryByText(/Showing the first part of/)).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Copy text' }))
    expect(writeClipboardText).toHaveBeenCalledWith(text)
  })

  it('shows single-column files as text', async () => {
    const view = renderPreview('list.csv', 'one\ntwo', 'text/csv')
    await waitFor(() => expect(view.container.ownerDocument.querySelector('[data-preview-kind="code"]')).toBeTruthy())
  })
})
