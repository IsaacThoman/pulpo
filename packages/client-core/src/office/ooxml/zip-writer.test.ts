import { readFileSync } from 'node:fs'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PACKAGE_LIMITS, OoxmlPackage } from './package.js'
import { readZip } from './zip.js'
import { writeZip } from './zip-writer.js'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../src/office/ooxml/fixtures/${name}`, import.meta.url)))
const contentTypes: [string, Uint8Array] = ['[Content_Types].xml', strToU8('<Types/>')]
const sameBytes = (actual: Uint8Array, expected: Uint8Array) => expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)

const BINARY_SIZES = [0, 1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 63, 64, 127, 128, 255, 256, 257, 258, 259, 511, 512,
  1023, 1024, 2047, 2048, 2452, 4095, 4096, 8191, 8192, 16383, 16384, 32767, 32768, 32769, 65534, 65535, 65536, 65537,
  131071, 131072, 262144, 1_048_576]

// A fixed PRNG makes failures reproducible while covering incompressible data, repeating
// binary sequences and long distance matches, including deflate block/window boundaries.
function payload(size: number, pattern: number): Uint8Array {
  let state = (size ^ 0x9e3779b9) >>> 0
  return Uint8Array.from({ length: size }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return pattern === 0 ? state >>> 24 : pattern === 1 ? index % 256 : index % 32768 < 32760 ? 0 : index % 251
  })
}

const officeFixtures = ['office', 'libreoffice', 'python', 'zip64'].flatMap((producer) => ['docx', 'xlsx', 'pptx'].map((extension) => `${producer}.${extension}`))
const otherFixtures = ['poi-sample.xlsx', 'proto-main.docx', 'tz-change.docx', 'valid-small-zip64.zip', 'python-descriptor.zip',
  'python-stored-descriptor.zip', 'python-zip64-descriptor.zip', 'python-local-zip64.zip']

describe('one-shot OOXML ZIP writer', () => {
  it.each([1, 3])('round-trips the POI printer-settings payload %s that streaming deflate corrupts', (id) => {
    const data = fixture(`printerSettings${id}.bin`)
    expect(data.length).toBe(2452)
    const path = `xl/printerSettings/printerSettings${id}.bin`
    const pkg = new OoxmlPackage(new Map([contentTypes, [path, data]]))
    const written = pkg.write()
    const parts = new Map(readZip(written, DEFAULT_PACKAGE_LIMITS))
    sameBytes(parts.get(path)!, data)
    sameBytes(OoxmlPackage.read(written).get(path)!, data)
  })

  it.each(BINARY_SIZES)('round-trips deterministic random and binary parts of %s bytes', (size) => {
    const parts = new Map<string, Uint8Array>([contentTypes])
    for (let pattern = 0; pattern < 3; pattern++) {
      const data = payload(size, pattern)
      parts.set(`binary${pattern}.bin`, data)
      parts.set(`media${pattern}.png`, data)
    }
    const pkg = new OoxmlPackage(parts)
    const written = pkg.write()
    const unpacked = new Map(readZip(written, DEFAULT_PACKAGE_LIMITS))
    const reread = OoxmlPackage.read(written)
    expect([...unpacked.keys()]).toEqual([...parts.keys()])
    for (const [path, bytes] of parts) {
      sameBytes(unpacked.get(path)!, bytes)
      sameBytes(reread.get(path)!, bytes)
    }
    sameBytes(pkg.write(), written)
  })

  it.each([...officeFixtures, ...otherFixtures])('exports %s as a readable, byte-preserving package', (name) => {
    const pkg = OoxmlPackage.read(fixture(name))
    const written = pkg.write()
    const reread = OoxmlPackage.read(written)
    expect(reread.paths()).toEqual(['[Content_Types].xml', ...pkg.paths().filter((path) => path !== '[Content_Types].xml')])
    for (const path of pkg.paths()) sameBytes(reread.get(path)!, pkg.get(path)!)
    sameBytes(reread.write(), written)
  })

  it.each([...officeFixtures, 'poi-sample.xlsx'])('matches zipSync byte for byte on %s', (name) => {
    const pkg = OoxmlPackage.read(fixture(name))
    const mtime = new Date(1980, 0, 1)
    const files: Zippable = {}
    for (const path of ['[Content_Types].xml', ...pkg.paths().filter((path) => path !== '[Content_Types].xml')]) {
      files[path] = [pkg.get(path)!, { level: /\.(png|jpe?g|gif|mp4|mp3|m4a|wdp|zip)$/i.test(path) ? 0 : 6, mtime }]
    }
    sameBytes(pkg.write(), zipSync(files, { mtime }))
  })

  it('sets only the UTF-8 flag for non-ASCII names and keeps numeric/object-property names in order', () => {
    const paths = ['__proto__', 'constructor', '0', '100', 'café.xml', '文字.xml', 'media/🙂.png']
    const pkg = new OoxmlPackage(new Map([contentTypes, ...paths.map((path): [string, Uint8Array] => [path, strToU8(path)])]))
    const bytes = pkg.write()
    const view = new DataView(bytes.buffer)
    let central = view.getUint32(bytes.length - 6, true)
    for (const path of ['[Content_Types].xml', ...paths]) {
      const local = view.getUint32(central + 42, true)
      const flags = [...path].some((character) => character.codePointAt(0)! > 0x7f) ? 0x800 : 0
      expect(view.getUint16(local + 6, true)).toBe(flags)
      expect(view.getUint16(central + 8, true)).toBe(flags)
      central += 46 + view.getUint16(central + 28, true)
    }
    const reread = OoxmlPackage.read(bytes)
    expect(reread.paths()).toEqual(['[Content_Types].xml', ...paths])
    for (const path of paths) sameBytes(reread.get(path)!, strToU8(path))
  })

  it('refuses exports beyond the reader limits or classic ZIP field widths', () => {
    const tooLarge = expect.objectContaining({ code: 'too_large' })
    expect(() => writeZip([contentTypes, ['second.xml', strToU8('<b/>')]], { maxEntries: 1, maxUncompressedBytes: 100 })).toThrow(tooLarge)
    expect(() => writeZip([contentTypes], { maxEntries: 1, maxUncompressedBytes: 7 })).toThrow(tooLarge)
    expect(() => writeZip([['a'.repeat(65536), new Uint8Array()]], DEFAULT_PACKAGE_LIMITS)).toThrow(tooLarge)
    const entries = function* (): Generator<[string, Uint8Array]> {
      for (let index = 0; index < 65535; index++) yield [`${index}.png`, new Uint8Array()]
    }
    expect(() => writeZip(entries(), { maxEntries: 65535, maxUncompressedBytes: 1 })).toThrow(tooLarge)
  })
})
