// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./use-attachment-preview-url', () => ({ useAttachmentPreviewUrl: mocks.load }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text }))
import { ToolImagePreview } from './ToolImagePreview'

const preview = { attachmentId: 'preview-1', name: 'chart.png.webp', mimeType: 'image/webp' as const, sizeBytes: 80 }
afterEach(() => { cleanup(); mocks.load.mockReset() })

describe('tool image preview', () => {
  it.each(['image/webp', 'image/png'] as const)('loads a %s result only on expansion and renders a thumbnail without a viewer', mimeType => {
    const preview = { attachmentId: 'preview-1', name: 'generated-image.png', mimeType, sizeBytes: 80 }
    mocks.load.mockReturnValue({ url: '/thumbnail.webp', loading: false })
    const view = render(<ToolImagePreview preview={preview} expanded={false} />)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(view.container.innerHTML).toBe('')
    view.rerender(<ToolImagePreview preview={preview} expanded />)
    expect(mocks.load).toHaveBeenCalledWith(preview.attachmentId, true, 'thumbnail')
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading image preview')
    fireEvent.load(screen.getByAltText(preview.name))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('img').getAttribute('alt')).toBe(preview.name)
    expect(screen.getByRole('img').className).toContain('max-h-48')
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<ToolImagePreview preview={preview} expanded={false} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows nothing for historical entries without preview metadata', () => {
    const view = render(<ToolImagePreview expanded />)
    expect(view.container.innerHTML).toBe('')
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('shows loading, unavailable, and image decode failure states', () => {
    mocks.load.mockReturnValue({ url: null, loading: true })
    const view = render(<ToolImagePreview preview={preview} expanded />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading image preview')
    mocks.load.mockReturnValue({ url: null, loading: false })
    view.rerender(<ToolImagePreview preview={preview} expanded />)
    expect(screen.getByRole('status').textContent).toBe('Image preview unavailable')
    mocks.load.mockReturnValue({ url: '/thumbnail.webp', loading: false })
    view.rerender(<ToolImagePreview preview={preview} expanded />)
    fireEvent.error(screen.getByAltText(preview.name))
    expect(screen.getByRole('status').textContent).toBe('Image preview unavailable')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
