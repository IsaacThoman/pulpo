import { describe, expect, it } from 'vitest'
import { appendFileReferences, fileNameError, fileNameSchema, fileReferenceHref, fileReferenceIds, isMarkdownName, normalizeFileName, splitFileReferences, updateFileFolderLayoutSchema, updateFileNodeSchema, updateSidebarItemSchema } from './files.js'

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

  it('keeps grid places of stored items and of the Trash', () => {
    const at = { x: 0, y: 0 }
    expect(updateFileFolderLayoutSchema.safeParse({ folderId: null, positions: { '01a146d5-cb9c-752b-b83f-22b4005894cc': at, trash: at } }).success).toBe(true)
    expect(updateFileFolderLayoutSchema.safeParse({ folderId: null, positions: { other: at } }).success).toBe(false)
  })
})

describe('file references', () => {
  const plan = { id: '0b5c5d0e-2b7f-4c3e-9a51-6f1d2c3b4a59', name: 'Plan [v2].md', folder: false }
  const work = { id: 'A1B2C3D4-0000-4000-8000-000000000001', name: 'Work', folder: true }

  it('appends references as a last paragraph of links and splits them back', () => {
    const text = appendFileReferences('Compare these', [plan, work, plan])
    expect(text).toBe(`Compare these\n\n[Plan \\[v2\\].md](/files/d/${plan.id}) [Work](/files/f/${work.id})`)
    expect(splitFileReferences(text)).toEqual({ text: 'Compare these', references: [plan, { ...work, id: work.id.toLowerCase() }] })
    expect(appendFileReferences('Hi', [])).toBe('Hi')
    expect(splitFileReferences(appendFileReferences('', [plan]))).toEqual({ text: '', references: [plan] })
  })

  it('leaves messages whose last paragraph is not only references alone', () => {
    const text = `See [Plan](/files/d/${plan.id}) for details`
    expect(splitFileReferences(text)).toEqual({ text, references: [] })
    expect(splitFileReferences('Just text')).toEqual({ text: 'Just text', references: [] })
  })

  it('finds every Files item a message links to, once each', () => {
    const text = `[a](/files/d/${plan.id}) https://pulpo.baby/files/f/${work.id} again /files/d/${plan.id} /files/d/not-an-id /files/d/${plan.id}x`
    expect(fileReferenceIds(text)).toEqual([plan.id, work.id.toLowerCase()])
    expect(fileReferenceHref(work)).toBe(`/files/f/${work.id}`)
  })
})
