import { describe, expect, it } from 'vitest'
import {
  attachmentPreviewKind,
  MAX_TEXT_PREVIEW_CHARACTERS,
  previewSizeLimit,
  truncateTextPreview,
} from './attachment-previews'

describe('attachmentPreviewKind', () => {
  it.each([
    ['photo.webp', 'image/webp', 'image'],
    ['vector.svg', 'image/svg+xml', 'image'],
    ['report.pdf', 'application/pdf', 'pdf'],
    ['README.md', 'application/octet-stream', 'markdown'],
    ['notes.txt', 'text/markdown', 'markdown'],
    ['payload.json', 'application/json', 'text'],
    ['Chapter 1.quiz', 'application/json', 'quiz'],
    ['landing.html', 'text/html', 'sandbox'],
    ['Dashboard.jsx', 'text/javascript', 'sandbox'],
    ['Widget.tsx', 'application/octet-stream', 'sandbox'],
    ['results.csv', 'application/octet-stream', 'table'],
    ['export', 'text/tab-separated-values', 'table'],
    ['analysis.ipynb', 'application/octet-stream', 'notebook'],
    ['main.rs', 'application/octet-stream', 'text'],
    ['Dockerfile', '', 'text'],
    ['config.yaml', 'application/yaml', 'text'],
    ['audio.m4a', 'audio/mp4', 'audio'],
    ['demo.mp4', 'video/mp4', 'video'],
    ['document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', null],
    ['archive.zip', 'application/zip', null],
  ] as const)('selects the preview for %s', (name, mimeType, expected) => {
    expect(attachmentPreviewKind(name, mimeType)).toBe(expected)
  })
})

describe('truncateTextPreview', () => {
  it('keeps short text and cuts long Markdown', () => {
    expect(truncateTextPreview('short')).toEqual({ text: 'short', truncated: false })
    const long = 'x'.repeat(MAX_TEXT_PREVIEW_CHARACTERS + 1)
    expect(truncateTextPreview(long)).toEqual({ text: long.slice(0, MAX_TEXT_PREVIEW_CHARACTERS), truncated: true })
  })
})

describe('previewSizeLimit', () => {
  it('lets virtualized viewers take larger files than Markdown', () => {
    expect(previewSizeLimit('table')).toBeGreaterThan(previewSizeLimit('text'))
    expect(previewSizeLimit('text')).toBeGreaterThan(previewSizeLimit('markdown'))
    expect(previewSizeLimit('notebook')).toBe(previewSizeLimit('table'))
  })
})
