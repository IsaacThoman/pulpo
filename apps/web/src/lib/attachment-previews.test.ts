import { describe, expect, it } from 'vitest'
import {
  attachmentPreviewKind,
  formatTextPreview,
  parseDelimitedPreview,
} from './attachment-previews'

describe('attachmentPreviewKind', () => {
  it.each([
    ['photo.webp', 'image/webp', 'image'],
    ['vector.svg', 'image/svg+xml', 'image'],
    ['report.pdf', 'application/pdf', 'pdf'],
    ['README.md', 'application/octet-stream', 'text'],
    ['payload.json', 'application/json', 'text'],
    ['results.csv', 'application/octet-stream', 'table'],
    ['audio.m4a', 'audio/mp4', 'audio'],
    ['demo.mp4', 'video/mp4', 'video'],
    ['document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', null],
    ['archive.zip', 'application/zip', null],
  ] as const)('selects the preview for %s', (name, mimeType, expected) => {
    expect(attachmentPreviewKind(name, mimeType)).toBe(expected)
  })
})

describe('formatTextPreview', () => {
  it('pretty prints valid JSON and preserves malformed JSON', () => {
    expect(formatTextPreview('payload.json', 'application/json', '{"ok":true}').text)
      .toBe('{\n  "ok": true\n}')
    expect(formatTextPreview('payload.json', 'application/json', '{oops').text).toBe('{oops')
  })
})

describe('parseDelimitedPreview', () => {
  it('parses quoted CSV cells and embedded delimiters', () => {
    expect(parseDelimitedPreview('results.csv', 'text/csv', 'Name,Note\nPulpo,"Fast, friendly"'))
      .toMatchObject({ headers: ['Name', 'Note'], rows: [['Pulpo', 'Fast, friendly']], truncated: false })
  })

  it('supports TSV and reports truncated row sets', () => {
    expect(parseDelimitedPreview('results.tsv', 'text/tab-separated-values', 'A\tB\n1\t2\n3\t4', 1))
      .toMatchObject({ headers: ['A', 'B'], rows: [['1', '2']], truncated: true })
  })

  it('falls back when delimited content has only one column', () => {
    expect(parseDelimitedPreview('results.csv', 'text/csv', 'Only one column')).toBeNull()
  })
})
