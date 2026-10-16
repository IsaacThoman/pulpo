import { describe, expect, it } from 'vitest'
import { previewKindForFile } from './code-preview.js'

describe('previewKindForFile', () => {
  it.each([
    ['index.html', '', 'html'],
    ['page.HTM', '', 'html'],
    ['App.jsx', '', 'jsx'],
    ['Widget.tsx', '', 'jsx'],
    ['logo.svg', '', 'svg'],
    ['export', 'text/html', 'html'],
    ['notes.txt', 'text/plain', null],
  ] as const)('maps %s (%s) to %s', (name, mimeType, expected) => {
    expect(previewKindForFile(name, mimeType)).toBe(expected)
  })
})
