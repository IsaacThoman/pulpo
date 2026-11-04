import { describe, expect, it } from 'vitest'
import {
  CODE_EXTENSIONS,
  codeLanguageFor,
  declaredDelimiter,
  DOCUMENT_EXTENSIONS,
  fileExtension,
  fileFamily,
  fileTypeOf,
  isTextFile,
  LEGACY_OFFICE_EXTENSIONS,
  mimeTypeForName,
  NOTEBOOK_EXTENSIONS,
  ODF_EXTENSIONS,
  OOXML_EXTENSIONS,
  PRESENTATION_EXTENSIONS,
  SHEET_EXTENSIONS,
  TEXT_EXTENSIONS,
} from './file-types.js'
import { filePreviewKind, MAX_TABLE_PREVIEW_BYTES, MAX_TEXT_PREVIEW_BYTES, previewKindOf } from './display.js'

// The lists each surface kept before the shared table; every entry must still classify the same way.
const LEGACY_SERVER_TEXT = 'txt md markdown csv tsv json jsonl yaml yml toml xml html htm css js jsx ts tsx py rb go rs java kt swift c h cpp hpp cs php sh sql log ini cfg conf env'.split(' ')
const LEGACY_WEB_PREVIEW_TEXT = 'c cc cpp cs css go h hpp html java js jsx json kt kts log md php py rb rs sh sql swift toml ts tsx txt vue xml yaml yml'.split(' ')
const LEGACY_CODE = 'c cc cpp cs css go h hpp html java js jsx json kt kts php py rb rs sh sql swift toml ts tsx vue xml yaml yml'.split(' ')

describe('file type table', () => {
  it('keeps every extension the old per-surface lists treated as text', () => {
    for (const extension of [...LEGACY_SERVER_TEXT, ...LEGACY_WEB_PREVIEW_TEXT]) {
      expect(TEXT_EXTENSIONS.has(extension), extension).toBe(true)
      expect(isTextFile(`file.${extension}`, null), extension).toBe(true)
    }
    for (const extension of LEGACY_CODE) expect(CODE_EXTENSIONS.has(extension), extension).toBe(true)
  })

  it('groups office formats by family and container', () => {
    expect([...SHEET_EXTENSIONS]).toEqual(expect.arrayContaining(['csv', 'tsv', 'xlsx', 'xls', 'ods', 'numbers']))
    expect([...DOCUMENT_EXTENSIONS]).toEqual(expect.arrayContaining(['docx', 'doc', 'odt', 'rtf']))
    expect([...PRESENTATION_EXTENSIONS]).toEqual(expect.arrayContaining(['pptx', 'ppt', 'odp']))
    expect([...LEGACY_OFFICE_EXTENSIONS].sort()).toEqual(['doc', 'dot', 'pot', 'pps', 'ppt', 'xls', 'xlt'])
    expect([...OOXML_EXTENSIONS]).toEqual(expect.arrayContaining(['docx', 'xlsx', 'pptx', 'xlsm']))
    expect([...ODF_EXTENSIONS]).toEqual(expect.arrayContaining(['odt', 'ods', 'odp']))
    expect([...NOTEBOOK_EXTENSIONS]).toEqual(['ipynb'])
    expect(fileTypeOf('Budget.XLSX')).toMatchObject({ family: 'spreadsheet', office: 'ooxml', text: false })
  })

  it('never lists binary office files as text', () => {
    for (const extension of [...DOCUMENT_EXTENSIONS, ...PRESENTATION_EXTENSIONS]) expect(isTextFile(`a.${extension}`), extension).toBe(false)
    expect(isTextFile('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false)
  })

  it('trusts the extension over the MIME type, then falls back to the MIME type', () => {
    expect(fileFamily('script.py', 'application/octet-stream')).toBe('code')
    expect(fileFamily('page.html', 'text/plain')).toBe('html')
    expect(fileFamily('noext', 'text/csv')).toBe('delimited')
    expect(fileFamily('noext', 'application/ld+json')).toBe('code')
    expect(fileFamily('noext', 'text/x-unknown')).toBe('text')
    expect(fileFamily('noext', 'application/octet-stream')).toBeNull()
    expect(fileFamily('photo', 'image/heic')).toBe('image')
  })

  it('recognizes whole-name text files and dotfiles', () => {
    expect(isTextFile('Dockerfile')).toBe(true)
    expect(isTextFile('repo/Makefile')).toBe(true)
    expect(isTextFile('.gitignore')).toBe(true)
    expect(codeLanguageFor('Makefile')).toBe('makefile')
    expect(codeLanguageFor('.env')).toBe('ini')
    expect(fileExtension('.env')).toBe('')
  })

  it('maps names to grammars and canonical MIME types', () => {
    expect(codeLanguageFor('App.tsx')).toBe('typescript')
    expect(codeLanguageFor('index.HTML')).toBe('xml')
    expect(codeLanguageFor('notes.txt')).toBeNull()
    expect(codeLanguageFor('blob', 'application/json; charset=utf-8')).toBe('json')
    expect(mimeTypeForName('Report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(mimeTypeForName('data.tsv')).toBe('text/tab-separated-values')
    expect(mimeTypeForName('mystery.qqq')).toBeNull()
  })

  it('declares delimiters for CSV and TSV only', () => {
    expect(declaredDelimiter('a.csv')).toBe(',')
    expect(declaredDelimiter('a.tsv')).toBe('\t')
    expect(declaredDelimiter('export', 'text/tab-separated-values')).toBe('\t')
    expect(declaredDelimiter('a.txt')).toBeNull()
  })
})

describe('Files preview kinds', () => {
  const blob = (name: string, mimeType: string | null, sizeBytes = 100) => ({ kind: 'blob' as const, name, mimeType, sizeBytes })

  it('opens each format in its viewer', () => {
    expect(filePreviewKind(blob('data.csv', 'text/csv'))).toBe('table')
    expect(filePreviewKind(blob('data.tsv', 'text/plain'))).toBe('table')
    expect(filePreviewKind(blob('page.html', 'text/html'))).toBe('html')
    expect(filePreviewKind(blob('logo.svg', 'image/svg+xml'))).toBe('svg')
    expect(filePreviewKind(blob('analysis.ipynb', 'application/octet-stream'))).toBe('notebook')
    expect(filePreviewKind(blob('main.rs', 'application/octet-stream'))).toBe('text')
    expect(filePreviewKind(blob('photo.png', 'image/png'))).toBe('image')
    expect(filePreviewKind(blob('notes.markdown', null))).toBe('markdown')
    expect(filePreviewKind(blob('test.quiz', 'application/json'))).toBe('quiz')
  })

  it('leaves office files to their download fallback', () => {
    expect(filePreviewKind(blob('Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull()
    expect(filePreviewKind(blob('Budget.xlsx', null))).toBeNull()
    expect(filePreviewKind(blob('Deck.pptx', null))).toBeNull()
  })

  it('refuses an image extension whose confirmed type is something else', () => {
    expect(previewKindOf('trick.png', 'text/html')).toBeNull()
  })

  it('applies each viewer its own size limit', () => {
    expect(filePreviewKind(blob('big.log', 'text/plain', MAX_TEXT_PREVIEW_BYTES))).toBe('text')
    expect(filePreviewKind(blob('big.log', 'text/plain', MAX_TEXT_PREVIEW_BYTES + 1))).toBeNull()
    expect(filePreviewKind(blob('big.csv', 'text/csv', MAX_TABLE_PREVIEW_BYTES))).toBe('table')
    expect(filePreviewKind(blob('big.csv', 'text/csv', MAX_TABLE_PREVIEW_BYTES + 1))).toBeNull()
  })
})
