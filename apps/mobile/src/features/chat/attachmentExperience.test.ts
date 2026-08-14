import { describe, expect, it } from 'vitest'
import {
  attachmentMetadata,
  attachmentTypeLabel,
  attachmentVisualKind,
  fitAttachmentPreviewSize,
  formatAttachmentSize,
  isImageAttachment,
  selectAttachmentBatch,
} from './attachmentExperience'

describe('attachment experience', () => {
  it('classifies generic MIME types by filename', () => {
    expect(attachmentVisualKind('photo.JPG', 'application/octet-stream')).toBe('image')
    expect(attachmentVisualKind('report.pdf', 'application/octet-stream')).toBe('pdf')
    expect(attachmentVisualKind('data.csv', 'application/octet-stream')).toBe('spreadsheet')
    expect(attachmentVisualKind('slides.key', 'application/octet-stream')).toBe('presentation')
    expect(attachmentVisualKind('source.swift', 'text/plain')).toBe('code')
    expect(attachmentVisualKind('backup.zip', 'application/octet-stream')).toBe('archive')
    expect(attachmentVisualKind('unknown.bin', 'application/octet-stream')).toBe('file')
  })

  it('prefers declared media MIME types', () => {
    expect(isImageAttachment('asset', 'image/webp')).toBe(true)
    expect(attachmentVisualKind('track', 'audio/mpeg')).toBe('audio')
    expect(attachmentVisualKind('clip', 'video/mp4')).toBe('video')
  })

  it('formats compact native metadata', () => {
    expect(formatAttachmentSize(800)).toBe('800 B')
    expect(formatAttachmentSize(10_240)).toBe('10 KB')
    expect(formatAttachmentSize(1_572_864)).toBe('1.5 MB')
    expect(attachmentTypeLabel('notes.md', 'text/plain')).toBe('MD')
    expect(attachmentMetadata('notes.md', 'text/plain', 10_240)).toBe('MD · 10 KB')
  })

  it('fits context-menu previews without cropping their aspect ratio', () => {
    expect(fitAttachmentPreviewSize(3024, 4032)).toEqual({ width: 315, height: 420 })
    expect(fitAttachmentPreviewSize(4032, 3024)).toEqual({ width: 320, height: 240 })
    expect(fitAttachmentPreviewSize(1000, 1000)).toEqual({ width: 320, height: 320 })
    expect(fitAttachmentPreviewSize(0, 0)).toEqual({ width: 320, height: 320 })
  })

  it('deduplicates and caps incoming selections', () => {
    const current = [{ uri: 'one' }, { uri: 'two' }]
    const result = selectAttachmentBatch(current, [
      { uri: 'two' }, { uri: 'three' }, { uri: 'four' }, { uri: 'five' }, { uri: 'six' }, { uri: 'seven' },
    ])
    expect(result.accepted.map((item) => item.uri)).toEqual(['three', 'four', 'five', 'six'])
    expect(result.duplicateCount).toBe(1)
    expect(result.overflowCount).toBe(1)
  })
})
