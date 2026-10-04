import { describe, expect, it } from 'vitest'
import { nextAvailableName } from '@pulpo/contracts'
import { attachmentFileName } from './names.js'

describe('Files sibling names', () => {
  it('keeps a free name and compares case-insensitively', () => {
    expect(nextAvailableName('Notes.md', new Set(['todo.md']))).toBe('Notes.md')
    expect(nextAvailableName('Notes.md', new Set(['notes.md']))).toBe('Notes (2).md')
  })

  it('skips taken suffixes and keeps the extension', () => {
    expect(nextAvailableName('photo.jpeg', new Set(['photo.jpeg', 'photo (2).jpeg', 'photo (3).jpeg']))).toBe('photo (4).jpeg')
  })

  it('treats dotfiles and folders as having no extension', () => {
    expect(nextAvailableName('.env', new Set(['.env']))).toBe('.env (2)')
    expect(nextAvailableName('Projects', new Set(['projects']))).toBe('Projects (2)')
  })

  it('truncates long names so the suffixed name stays within the limit', () => {
    const long = `${'a'.repeat(252)}.md`
    const next = nextAvailableName(long, new Set([long]))
    expect([...next]).toHaveLength(255)
    expect(next.endsWith(' (2).md')).toBe(true)
  })
})

describe('attachment names in Files', () => {
  it('keeps a valid name', () => {
    expect(attachmentFileName('  report.pdf ')).toBe('report.pdf')
  })

  it('replaces characters Files rejects and cuts long names', () => {
    expect(attachmentFileName('a/b\u0007c.txt')).toBe('a-b-c.txt')
    expect([...attachmentFileName('x'.repeat(300))]).toHaveLength(255)
  })

  it('falls back when nothing usable is left', () => {
    expect(attachmentFileName('   ')).toBe('Attachment')
    expect(attachmentFileName('..')).toBe('Attachment')
  })
})
