import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { LiveFormatError } from '../live-format.js'
import { OoxmlPackage, relationshipsPathFor, relativeTarget, resolveTarget } from './package.js'

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
const DOCUMENT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>'

function samplePackage(extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
    'word/media/image1.png': new Uint8Array([1, 2, 3]),
    ...extra,
  })
}

describe('OoxmlPackage', () => {
  it('writes the same bytes for the same content, whenever it writes', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const first = OoxmlPackage.read(samplePackage()).write()
      vi.setSystemTime(new Date('2026-06-30T23:59:58Z'))
      const second = OoxmlPackage.read(samplePackage()).write()
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads parts, content types, and relationships', () => {
    const pkg = OoxmlPackage.read(samplePackage())
    expect(pkg.mainPart()).toBe('word/document.xml')
    expect(pkg.contentType('word/document.xml')).toContain('wordprocessingml.document.main')
    expect(pkg.contentType('/word/other.xml')).toBe('application/xml')
    expect(pkg.xml('word/document.xml')?.documentElement?.localName).toBe('document')
  })

  it('writes untouched parts back byte for byte and edited XML in place', () => {
    const pkg = OoxmlPackage.read(samplePackage())
    const document = pkg.xml('word/document.xml')!
    document.getElementsByTagName('w:t').item(0)!.textContent = 'Hello'
    const reread = OoxmlPackage.read(pkg.write())
    expect(reread.get('word/media/image1.png')).toEqual(new Uint8Array([1, 2, 3]))
    expect(reread.text('_rels/.rels')).toBe(ROOT_RELS)
    expect(reread.text('word/document.xml')).toContain('<w:t>Hello</w:t>')
    expect(reread.paths()[0]).toBe('[Content_Types].xml')
  })

  it('preserves XML bytes after read-only inspection, including UTF-16 and package metadata', () => {
    const original = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(DOCUMENT.replace('UTF-8', 'UTF-16'), 'utf16le')]))
    const pkg = OoxmlPackage.read(samplePackage({ 'word/document.xml': original }))
    pkg.mainPart()
    pkg.contentType('word/document.xml')
    const document = pkg.xml('word/document.xml')!
    expect(document.documentElement?.localName).toBe('document')
    expect(pkg.get('word/document.xml')).toEqual(original)
    const reread = OoxmlPackage.read(pkg.write())
    expect(reread.get('word/document.xml')).toEqual(original)
    expect(reread.text('_rels/.rels')).toBe(ROOT_RELS)
    expect(reread.text('[Content_Types].xml')).toBe(CONTENT_TYPES)
    // A later mutation of that same cached DOM must still be written, including after get().
    document.getElementsByTagName('w:t').item(0)!.textContent = 'Edited'
    expect(OoxmlPackage.read(pkg.write()).text('word/document.xml')).toContain('<w:t>Edited</w:t>')
    pkg.get('word/document.xml')
    document.getElementsByTagName('w:t').item(0)!.textContent = 'Edited again'
    expect(OoxmlPackage.read(pkg.write()).text('word/document.xml')).toContain('<w:t>Edited again</w:t>')
  })

  it('adds relationships with fresh ids and content type overrides', () => {
    const pkg = OoxmlPackage.read(samplePackage())
    const id = pkg.addRelationship('word/document.xml', 'urn:image', 'media/image1.png')
    expect(id).toBe('rId1')
    expect(pkg.relationshipTarget('word/document.xml', id)).toBe('word/media/image1.png')
    pkg.setContentType('word/media/image1.png', 'image/png')
    pkg.ensureDefaultContentType('png', 'image/png')
    const reread = OoxmlPackage.read(pkg.write())
    expect(reread.contentType('word/media/image1.png')).toBe('image/png')
    expect(reread.relationships('word/document.xml')).toEqual([{ id: 'rId1', type: 'urn:image', target: 'media/image1.png' }])
    pkg.removeRelationship('word/document.xml', id)
    expect(pkg.relationships('word/document.xml')).toEqual([])
  })

  it('resolves and builds relationship targets', () => {
    expect(relationshipsPathFor('')).toBe('_rels/.rels')
    expect(relationshipsPathFor('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
    expect(resolveTarget('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolveTarget('ppt/slides/slide1.xml', '/ppt/media/a.png')).toBe('ppt/media/a.png')
    expect(relativeTarget('ppt/slides/slide1.xml', 'ppt/media/image1.png')).toBe('../media/image1.png')
    expect(relativeTarget('word/document.xml', 'word/styles.xml')).toBe('styles.xml')
  })

  it('refuses encrypted, non-zip, malformed, and oversized files', () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(() => OoxmlPackage.read(cfb)).toThrow(expect.objectContaining({ code: 'encrypted' }))
    expect(() => OoxmlPackage.read(strToU8('hello'))).toThrow(LiveFormatError)
    expect(() => OoxmlPackage.read(zipSync({ 'a.xml': strToU8('<a/>') }))).toThrow(expect.objectContaining({ code: 'corrupt' }))
    expect(() => OoxmlPackage.read(samplePackage(), { maxEntries: 2, maxUncompressedBytes: 1e9 })).toThrow(expect.objectContaining({ code: 'too_large' }))
    expect(() => OoxmlPackage.read(samplePackage(), { maxEntries: 100, maxUncompressedBytes: 100 })).toThrow(expect.objectContaining({ code: 'too_large' }))
    const pkg = OoxmlPackage.read(samplePackage({ 'word/bad.xml': strToU8('<a><b></a>') }))
    expect(() => pkg.xml('word/bad.xml')).toThrow(expect.objectContaining({ code: 'corrupt' }))
  })

  it('refuses zips whose directory and entries disagree on names', () => {
    const bytes = samplePackage()
    // Rename one local header so it no longer matches the central directory.
    const local = bytes.findIndex((_, index) => bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 3 && bytes[index + 3] === 4 && new TextDecoder().decode(bytes.subarray(index + 30, index + 30 + 17)) === 'word/document.xml')
    const tampered = bytes.slice()
    tampered[local + 30 + 5] = 'X'.charCodeAt(0)
    expect(() => OoxmlPackage.read(tampered)).toThrow(expect.objectContaining({ code: 'corrupt' }))
  })

  it('refuses Unicode Path fields that rename an entry', () => {
    const renamed = new Uint8Array([1, 0, 0, 0, 0, ...strToU8('word/other.xml')])
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': [strToU8(DOCUMENT), { extra: { 0x7075: renamed } }],
    })
    expect(() => OoxmlPackage.read(bytes)).toThrow(expect.objectContaining({ code: 'corrupt' }))
  })
})
