import { describe, expect, it } from 'vitest'
import { fileNameError, fileNameSchema, normalizeFileName, updateFileNodeSchema } from './files.js'

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

  it('requires a rename or move in updates', () => {
    expect(updateFileNodeSchema.safeParse({ expectedRevision: 1 }).success).toBe(false)
    expect(updateFileNodeSchema.safeParse({ parentId: null }).success).toBe(true)
  })
})
