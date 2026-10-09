import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MessageAttachmentList, PendingAttachmentChip } from './AttachmentImage'

vi.hoisted(() => {
  const mediaQuery = { matches: false, addEventListener: () => undefined }
  Object.assign(globalThis, {
    document: { documentElement: { classList: { contains: () => false, toggle: () => undefined } } },
    window: { matchMedia: () => mediaQuery },
  })
})

// react-virtuoso (table previews) probes the DOM when it loads, which this stub document lacks.
vi.mock('react-virtuoso', () => ({ TableVirtuoso: () => null }))

function renderMessageAttachments() {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><MessageAttachmentList attachments={[
    { id: 'pdf', name: 'report.pdf', mimeType: 'application/pdf', type: 'file', size: 1_024 },
    { id: 'zip', name: 'source.zip', mimeType: 'application/zip', type: 'file', size: 2_048 },
  ]} /></MemoryRouter></QueryClientProvider>)
}

describe('attachment card actions', () => {
  it('separates preview from the save menu (download or save to Files) for message files', () => {
    const markup = renderMessageAttachments()

    expect(markup).toContain('aria-label="Preview report.pdf"')
    expect(markup).toContain('aria-label="Save report.pdf"')
    expect(markup).not.toContain('aria-label="Preview source.zip"')
    expect(markup).toContain('aria-label="Save source.zip"')
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
    expect(markup.match(/<button[^>]+aria-label="Preview notes\.md"[^>]*>/)?.[0]).toContain('h-full')
    expect(markup).toContain('aria-label="Download notes.md"')
    expect(markup).toContain('aria-label="Remove notes.md"')
  })
})
