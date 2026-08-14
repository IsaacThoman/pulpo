import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageAttachmentList, PendingAttachmentChip } from './AttachmentImage'

vi.hoisted(() => {
  const mediaQuery = { matches: false, addEventListener: () => undefined }
  Object.assign(globalThis, {
    document: { documentElement: { classList: { toggle: () => undefined } } },
    window: { matchMedia: () => mediaQuery },
  })
})

describe('attachment card actions', () => {
  it('separates preview and download actions for supported message files', () => {
    const markup = renderToStaticMarkup(<MessageAttachmentList attachments={[
      { id: 'pdf', name: 'report.pdf', mimeType: 'application/pdf', type: 'file', size: 1_024 },
      { id: 'zip', name: 'source.zip', mimeType: 'application/zip', type: 'file', size: 2_048 },
    ]} />)

    expect(markup).toContain('aria-label="Preview report.pdf"')
    expect(markup).toContain('aria-label="Download report.pdf"')
    expect(markup).not.toContain('aria-label="Preview source.zip"')
    expect(markup).toContain('aria-label="Download source.zip"')
  })

  it('keeps composer preview, download, and removal as distinct controls', () => {
    const markup = renderToStaticMarkup(<PendingAttachmentChip
      name="notes.md"
      mimeType="text/markdown"
      size={12}
      sourceFile={new File(['Preview me'], 'notes.md', { type: 'text/markdown' })}
      onDownload={() => undefined}
      onRemove={() => undefined}
    />)

    expect(markup).toContain('aria-label="Preview notes.md"')
    expect(markup).toContain('aria-label="Download notes.md"')
    expect(markup).toContain('aria-label="Remove notes.md"')
  })
})
