import { describe, expect, it } from 'vitest'
import { imagePreviewGroup, previewFallbackMessage, previewSource } from './attachmentPreviewPolicy'

describe('attachment preview policy', () => {
  const attachments = [
    { id: 'image-1', name: 'one.jpg', uri: 'file:///one.jpg', kind: 'image' as const },
    { id: 'file-1', name: 'notes.pdf', kind: 'file' as const },
    { id: 'image-2', name: 'two.jpg', kind: 'image' as const },
  ]

  it('groups only images from the tapped message and preserves the selected position', () => {
    expect(imagePreviewGroup(attachments, 'image-2')).toEqual({
      items: [attachments[0], attachments[2]], initialIndex: 1,
    })
    expect(imagePreviewGroup(attachments, 'file-1')).toBeNull()
  })

  it('uses local files immediately and lazily downloads sent attachments', () => {
    expect(previewSource(attachments[0])).toEqual({ kind: 'local', uri: 'file:///one.jpg' })
    expect(previewSource(attachments[2])).toEqual({ kind: 'download', id: 'image-2', name: 'two.jpg' })
  })

  it('offers a concise share fallback for unsupported and presentation failures', () => {
    expect(previewFallbackMessage('ERR_ATTACHMENT_PREVIEW_UNSUPPORTED')).toContain('cannot preview')
    expect(previewFallbackMessage('ERR_ATTACHMENT_PREVIEW_UNAVAILABLE')).toContain('open it in another app')
  })
})
