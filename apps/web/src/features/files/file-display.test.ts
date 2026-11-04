import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { filePreviewKind, filesErrorMessage, isTextPreview, MAX_INLINE_PREVIEW_BYTES, MAX_TEXT_PREVIEW_BYTES, mediaMimeType, previewFillsView } from './file-display'

const blob = (name: string, mimeType: string | null, sizeBytes = 100) => ({ kind: 'blob' as const, name, mimeType, sizeBytes })

describe('Files previews', () => {
  it('chooses a preview from the confirmed type, then the extension', () => {
    expect(filePreviewKind(blob('photo.png', 'image/png'))).toBe('image')
    expect(filePreviewKind(blob('paper', 'application/pdf'))).toBe('pdf')
    expect(filePreviewKind(blob('notes.md', 'application/octet-stream'))).toBe('markdown')
    expect(filePreviewKind(blob('data.json', 'application/octet-stream'))).toBe('text')
    expect(filePreviewKind(blob('archive.zip', 'application/zip'))).toBeNull()
    expect(filePreviewKind({ kind: 'folder', name: 'Docs', mimeType: null, sizeBytes: 0 })).toBeNull()
  })

  it('skips in-memory previews for large files but still streams media', () => {
    expect(filePreviewKind(blob('huge.png', 'image/png', MAX_INLINE_PREVIEW_BYTES + 1))).toBeNull()
    expect(filePreviewKind(blob('big.log', 'text/plain', MAX_TEXT_PREVIEW_BYTES + 1))).toBeNull()
    expect(filePreviewKind(blob('movie.mp4', 'video/mp4', MAX_INLINE_PREVIEW_BYTES + 1))).toBe('video')
  })

  it('previews audio and video stored under a generic type by extension', () => {
    expect(filePreviewKind(blob('memo.m4a', 'application/octet-stream'))).toBe('audio')
    expect(filePreviewKind(blob('memo.M4A', null, MAX_INLINE_PREVIEW_BYTES + 1))).toBe('audio')
    expect(filePreviewKind(blob('memo.m4a', 'audio/x-m4a'))).toBe('audio')
    expect(filePreviewKind(blob('clip.webm', 'application/octet-stream'))).toBe('video')
    expect(filePreviewKind(blob('song.wma', 'application/octet-stream'))).toBeNull()
  })

  it('plays media as its stored media type, or the type its extension implies', () => {
    expect(mediaMimeType('memo.m4a', 'audio/x-m4a')).toBe('audio/x-m4a')
    expect(mediaMimeType('memo.m4a', 'application/octet-stream')).toBe('audio/mp4')
    expect(mediaMimeType('memo.m4a', null)).toBe('audio/mp4')
    expect(mediaMimeType('notes.txt', 'text/plain')).toBeNull()
  })

  it('opens CSV, HTML, SVG, notebooks, and code in viewers that fill the view', () => {
    for (const [name, mimeType, kind] of [
      ['data.csv', 'text/csv', 'table'],
      ['page.html', 'text/html', 'html'],
      ['logo.svg', 'image/svg+xml', 'svg'],
      ['analysis.ipynb', 'application/x-ipynb+json', 'notebook'],
      ['main.go', 'text/plain', 'text'],
    ] as const) {
      expect(filePreviewKind(blob(name, mimeType))).toBe(kind)
      expect(isTextPreview(kind)).toBe(true)
      expect(previewFillsView(kind)).toBe(true)
    }
    expect(previewFillsView('markdown')).toBe(false)
    expect(isTextPreview('image')).toBe(false)
  })

  it('explains name conflicts with the attempted name', () => {
    expect(filesErrorMessage(new ApiError(409, 'file_name_conflict', 'server copy'), 'Plans')).toBe('An item named "Plans" already exists here')
    expect(filesErrorMessage(new ApiError(500, 'other', 'Server said no'))).toBe('Server said no')
  })
})
