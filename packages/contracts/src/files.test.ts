import { describe, expect, it } from 'vitest'
import { canExportOfficePdf, convertedFileName, fileExtension, fileNameError, officeConversionTarget, fileNameSchema, isMarkdownName, normalizeFileName, updateFileFolderLayoutSchema, updateFileNodeSchema, updateSidebarItemSchema } from './files.js'

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

describe('office conversion names', () => {
  it('maps legacy, OpenDocument, iWork, and template files to the format they convert to', () => {
    expect(officeConversionTarget('Report.DOC')).toBe('docx')
    expect(officeConversionTarget('notes.odt')).toBe('docx')
    expect(officeConversionTarget('Letter.wpd')).toBe('docx')
    expect(officeConversionTarget('Essay.pages')).toBe('docx')
    expect(officeConversionTarget('Template.dotx')).toBe('docx')
    expect(officeConversionTarget('Budget.xls')).toBe('xlsx')
    expect(officeConversionTarget('Budget.numbers')).toBe('xlsx')
    expect(officeConversionTarget('Deck.key')).toBe('pptx')
    expect(officeConversionTarget('Show.pps')).toBe('pptx')
    // Already editable, or not office files at all.
    expect(officeConversionTarget('Report.docx')).toBeNull()
    expect(officeConversionTarget('photo.png')).toBeNull()
    expect(officeConversionTarget('doc')).toBeNull()
    expect(officeConversionTarget('.doc')).toBeNull()
    expect(officeConversionTarget('x.constructor')).toBeNull()
  })

  it('offers PDF export for every office file', () => {
    expect(canExportOfficePdf('Report.docx')).toBe(true)
    expect(canExportOfficePdf('Budget.XLSX')).toBe(true)
    expect(canExportOfficePdf('Deck.ppt')).toBe(true)
    expect(canExportOfficePdf('notes.md')).toBe(false)
    expect(canExportOfficePdf('scan.pdf')).toBe(false)
  })

  it('keeps converted names within the code-point length limit', () => {
    for (const character of ['a', '😀']) {
      const name = convertedFileName(`${character.repeat(251)}.doc`, 'docx')
      expect([...name]).toHaveLength(255)
      expect(name).toBe(`${character.repeat(250)}.docx`)
      expect(fileNameError(name)).toBeNull()
    }
  })

  it('swaps the extension of the converted file', () => {
    expect(convertedFileName('Report.doc', 'docx')).toBe('Report.docx')
    expect(convertedFileName('Q3.final.xls', 'xlsx')).toBe('Q3.final.xlsx')
    expect(convertedFileName('Deck.key', 'pdf')).toBe('Deck.pdf')
    expect(fileExtension('archive.tar.GZ')).toBe('gz')
    expect(fileExtension('.env')).toBe('')
  })
})
