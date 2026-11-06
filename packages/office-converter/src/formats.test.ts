import { describe, expect, it } from 'vitest'
import { planConversion, sniffSignature, supportedConversions, supportsConversion, UnsupportedConversionError } from './formats.js'

const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])
const rtf = new TextEncoder().encode('{\\rtf1\\ansi hello}')

function planError(from: string, to: string, bytes: Uint8Array): string {
  try {
    planConversion(from, to, bytes)
  } catch (error) {
    if (error instanceof UnsupportedConversionError) return error.code
    throw error
  }
  return 'planned'
}

describe('conversion formats', () => {
  it('converts every input to its editable format and to PDF, never to itself or across families', () => {
    expect(supportsConversion('doc', 'docx')).toBe(true)
    expect(supportsConversion('numbers', 'xlsx')).toBe(true)
    expect(supportsConversion('key', 'pptx')).toBe(true)
    expect(supportsConversion('dotx', 'docx')).toBe(true)
    expect(supportsConversion('xlsx', 'pdf')).toBe(true)
    expect(supportsConversion('docx', 'docx')).toBe(false)
    expect(supportsConversion('doc', 'xlsx')).toBe(false)
    expect(supportsConversion('exe', 'pdf')).toBe(false)
    expect(supportsConversion('doc', 'odt')).toBe(false)
    // Only own properties: "constructor" or "__proto__" must not look like formats.
    expect(supportsConversion('constructor', 'pdf')).toBe(false)
    expect(supportsConversion('doc', '__proto__')).toBe(false)
    const pairs = supportedConversions()
    expect(pairs).toContainEqual({ from: 'wpd', to: 'docx' })
    expect(pairs.filter((pair) => pair.to === 'pdf')).toHaveLength(21)
    expect(pairs.filter((pair) => pair.to !== 'pdf')).toHaveLength(18)
  })

  it('recognizes containers by their first bytes', () => {
    expect(sniffSignature(cfb)).toBe('cfb')
    expect(sniffSignature(zip)).toBe('zip')
    expect(sniffSignature(rtf)).toBe('rtf')
    expect(sniffSignature(new Uint8Array([0xff, 0x57, 0x50, 0x43, 1]))).toBe('wpd')
    expect(sniffSignature(new TextEncoder().encode('<html><img src="http://example.com/x.png">'))).toBeNull()
    expect(sniffSignature(new Uint8Array())).toBeNull()
  })

  it('forces the import filter the file name promises', () => {
    expect(planConversion('doc', 'docx', cfb)).toMatchObject({ importFilter: 'MS Word 97', exportFilter: 'docx:MS Word 2007 XML' })
    // Word documents saved as RTF under a .doc name are common.
    expect(planConversion('doc', 'docx', rtf)).toMatchObject({ importFilter: 'Rich Text Format' })
    expect(planConversion('xls', 'pdf', cfb)).toMatchObject({ importFilter: 'MS Excel 97', exportFilter: 'pdf:calc_pdf_Export' })
    expect(planConversion('pps', 'pptx', cfb)).toMatchObject({ importFilter: 'MS PowerPoint 97 AutoPlay' })
    // Encrypted Office Open XML packages are compound files.
    expect(planConversion('docx', 'pdf', cfb)).toMatchObject({ importFilter: 'MS Word 2007 XML' })
  })

  it('refuses content that is not what the name says, so no other import filter ever reads it', () => {
    expect(planError('doc', 'docx', new TextEncoder().encode('<html><body>hi</body></html>'))).toBe('unexpected_content')
    expect(planError('odt', 'docx', cfb)).toBe('unexpected_content')
    expect(planError('rtf', 'docx', zip)).toBe('unexpected_content')
    expect(planError('xls', 'xlsx', rtf)).toBe('unexpected_content')
    expect(planError('doc', 'pptx', cfb)).toBe('unsupported_conversion')
  })
})
