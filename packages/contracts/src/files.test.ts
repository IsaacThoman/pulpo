import { describe, expect, it } from 'vitest'
import { fileNameError, fileNameSchema, isMarkdownName, normalizeFileName, updateFileNodeSchema, updateSidebarItemSchema } from './files.js'

describe('Files names', () => {
  it('normalizes to trimmed NFC', () => {
    expect(normalizeFileName('  Café.md ')).toBe('Café.md')
    expect(fileNameSchema.parse(' Report ')).toBe('Report')
  })

  it('rejects empty, reserved, oversized, and unsafe names', () => {
    expect(fileNameError('')).toBe('empty')
    expect(fileNameError('..')).toBe('reserved')
    expect(fileNameError('a/b')).toBe('invalid_character')
    expect(fileNameError('line\nbreak')).toBe('invalid_character')
    expect(fileNameError('😀'.repeat(255))).toBeNull()
    expect(fileNameError('😀'.repeat(256))).toBe('too_long')
    expect(fileNameSchema.safeParse('   ').success).toBe(false)
  })

  it('requires a rename, move, or new look in updates', () => {
    expect(updateFileNodeSchema.safeParse({ expectedRevision: 1 }).success).toBe(false)
    expect(updateFileNodeSchema.safeParse({ parentId: null }).success).toBe(true)
    expect(updateFileNodeSchema.safeParse({ color: null }).success).toBe(true)
    expect(updateFileNodeSchema.safeParse({ icon: 'rocket' }).success).toBe(true)
    expect(updateFileNodeSchema.safeParse({ icon: 'unicorn' }).success).toBe(false)
    expect(updateSidebarItemSchema.safeParse({}).success).toBe(false)
    expect(updateSidebarItemSchema.safeParse({ color: 'teal' }).success).toBe(true)
  })
})

describe('Markdown names', () => {
  it('recognizes .md and .markdown in any case', () => {
    expect(isMarkdownName('notes.md')).toBe(true)
    expect(isMarkdownName('README.MARKDOWN')).toBe(true)
    expect(isMarkdownName('notes.md.txt')).toBe(false)
    expect(isMarkdownName('md')).toBe(false)
  })
})
