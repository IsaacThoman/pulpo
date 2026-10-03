import { describe, expect, it } from 'vitest'
import {
  attachmentPreviewKind,
  formatTextPreview,
  createDelimitedReader,
} from './attachment-previews'

describe('attachmentPreviewKind', () => {
  it.each([
    ['photo.webp', 'image/webp', 'image'],
    ['vector.svg', 'image/svg+xml', 'image'],
    ['report.pdf', 'application/pdf', 'pdf'],
    ['README.md', 'application/octet-stream', 'markdown'],
    ['notes.txt', 'text/markdown', 'markdown'],
    ['payload.json', 'application/json', 'text'],
    ['landing.html', 'text/html', 'sandbox'],
    ['Dashboard.jsx', 'text/javascript', 'sandbox'],
    ['Widget.tsx', 'application/octet-stream', 'sandbox'],
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

describe('createDelimitedReader', () => {
  it('parses quoted CSV cells, embedded delimiters, and quoted newlines', () => {
    const reader = createDelimitedReader('results.csv', 'text/csv', 'Name,Note\nPulpo,"Fast, friendly"\nOcto,"two\nlines ""quoted"""')
    expect(reader?.headers).toEqual(['Name', 'Note'])
    expect(reader?.next(10)).toEqual([['Pulpo', 'Fast, friendly'], ['Octo', 'two\nlines "quoted"']])
    expect(reader?.done).toBe(true)
  })

  it('reads TSV rows in batches until the file is exhausted', () => {
    const reader = createDelimitedReader('results.tsv', 'text/tab-separated-values', 'A\tB\r\n1\t2\r\n3\t4\r\n5\t6\r\n')!
    expect(reader.next(2)).toEqual([['1', '2'], ['3', '4']])
    expect(reader.done).toBe(false)
    expect(reader.next(2)).toEqual([['5', '6']])
    expect(reader.done).toBe(true)
    expect(reader.next(2)).toEqual([])
  })

  it('aligns ragged rows to the header, skips blank lines, and strips a BOM', () => {
    const reader = createDelimitedReader('ragged.csv', 'text/csv', '\uFEFFA,,C\n1\n\n1,2,3,4\n')!
    expect(reader.headers).toEqual(['A', 'Column 2', 'C'])
    expect(reader.next(10)).toEqual([['1', '', ''], ['1', '2', '3']])
  })

  it('caps the number of columns', () => {
    const reader = createDelimitedReader('wide.csv', 'text/csv', 'a,b,c,d\n1,2,3,4', 2)!
    expect(reader.headers).toEqual(['a', 'b'])
    expect(reader.next(1)).toEqual([['1', '2']])
  })

  it('falls back when delimited content has only one column', () => {
    expect(createDelimitedReader('results.csv', 'text/csv', 'Only one column')).toBeNull()
    expect(createDelimitedReader('empty.csv', 'text/csv', '')).toBeNull()
  })
})
