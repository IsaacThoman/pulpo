// @vitest-environment jsdom
import { act, createElement } from 'react'
import type { ToolImagePreview as Preview } from '@pulpo/contracts'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('../features/chat/api', () => ({ downloadAttachmentThumbnail: mocks.download }))
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) => createElement('span', null, children),
  Image: ({ accessibilityLabel, source, onError, resizeMode, style }: {
    accessibilityLabel: string; source: { uri: string }; onError: () => void; resizeMode: string; style: { height: number }
  }) => createElement('img', { alt: accessibilityLabel, src: source.uri, onError, 'data-resize-mode': resizeMode, height: style.height }),
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel: string }) => createElement('span', { role: 'status', 'aria-label': accessibilityLabel }),
}))
import { ToolImagePreview } from './ToolImagePreview'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const preview = { attachmentId: 'preview-1', name: 'chart.png.webp', mimeType: 'image/webp' as const, sizeBytes: 80 }
let root: Root | undefined
let container: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  mocks.download.mockReset()
})
async function render(expanded: boolean, metadata: Preview | undefined = preview) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root!.render(createElement(ToolImagePreview, { expanded, preview: metadata, mutedColor: '#888' })))
}
afterEach(() => { root = undefined })

describe('mobile tool image preview', () => {
  it.each(['image/webp', 'image/png'] as const)('downloads a %s result only on expansion and displays a contained noninteractive thumbnail', async mimeType => {
    const preview = { attachmentId: 'preview-1', name: 'generated-image.png', mimeType, sizeBytes: 80 }
    mocks.download.mockResolvedValue({ uri: 'file:///thumbnail.webp' })
    await render(false)
    expect(mocks.download).not.toHaveBeenCalled()
    await render(true, preview)
    expect(mocks.download).toHaveBeenCalledWith(preview.attachmentId)
    const image = container.querySelector('img')!
    expect(image.alt).toBe(preview.name)
    expect(image.height).toBe(192)
    expect(image.dataset.resizeMode).toBe('contain')
    expect(container.querySelector('button')).toBeNull()
    await render(false)
    expect(container.innerHTML).toBe('')
  })

  it('shows no image for a legacy entry', async () => {
    await render(false)
    await act(async () => root!.render(createElement(ToolImagePreview, { expanded: true, mutedColor: '#888' })))
    expect(container.innerHTML).toBe('')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('shows a loading placeholder and handles download failure', async () => {
    let reject!: (error: Error) => void
    mocks.download.mockReturnValue(new Promise((_, fail) => { reject = fail }))
    await render(true)
    expect(container.querySelector('[role=status]')?.getAttribute('aria-label')).toBe('Loading image preview')
    await act(async () => reject(new Error('Unavailable')))
    expect(container.textContent).toBe('Image preview unavailable')
  })

  it('handles image decode failure without showing a broken image', async () => {
    mocks.download.mockResolvedValue({ uri: 'file:///thumbnail.webp' })
    await render(true)
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.textContent).toBe('Image preview unavailable')
    expect(container.querySelector('img')).toBeNull()
  })
})
