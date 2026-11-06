import { readFileSync } from 'node:fs'
import { Inflate, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { OoxmlPackage } from './package.js'
import { zipDescriptorEnd } from './zip.js'

// tsc emits test modules into dist too; their binary fixture data stays in src.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../src/office/ooxml/fixtures/${name}`, import.meta.url)))
const corrupt = expect.objectContaining({ code: 'corrupt' })

function headers(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  const locator = end - 20
  const zip64 = view.getUint32(locator, true) === 0x07064b50 ? Number(view.getBigUint64(locator + 8, true)) : undefined
  const central = zip64 === undefined ? view.getUint32(end + 16, true) : Number(view.getBigUint64(zip64 + 48, true))
  // Every fixture used for header mutations has its first local header at offset 0.
  const local = 0
  const extra = central + 46 + view.getUint16(central + 28, true)
  const localExtra = local + 30 + view.getUint16(local + 26, true)
  return { view, end, locator, zip64, central, local, extra, localExtra }
}

function plain(data = '123456789', level: 0 | 6 = 6): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8(data) }, { level })
}

describe('bounded, verified OOXML ZIP reads', () => {
  it.each([
    ['bypass-sentinel.zip', 'corrupt'],
    ['zip64-renamed-local.zip', 'corrupt'],
    ['local-method-mismatch.zip', 'corrupt'],
    ['mismatched-counts.zip', 'corrupt'],
    ['encrypted-real.zip', 'encrypted'],
  ])('rejects the independent review reproduction %s', (name, code) => {
    expect(() => OoxmlPackage.read(fixture(name!))).toThrow(expect.objectContaining({ code }))
  })

  it('aborts understated deflate output before inflating the 32 MiB stream', () => {
    const bytes = fixture('understated-deflate.zip')
    const push = vi.spyOn(Inflate.prototype, 'push')
    try {
      expect(() => OoxmlPackage.read(bytes, { maxEntries: 100, maxUncompressedBytes: 40_000 })).toThrow(corrupt)
      const supplied = push.mock.calls.reduce((total, [chunk]) => total + chunk.length, 0)
      expect(supplied).toBeLessThan(2048)
    } finally {
      push.mockRestore()
    }
  })

  it('accepts the same highly compressed 32 MiB stream when its size and budget are truthful', () => {
    const bytes = fixture('understated-deflate.zip')
    const view = new DataView(bytes.buffer)
    const end = bytes.length - 22
    let central = view.getUint32(end + 16, true)
    central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true)
    const local = view.getUint32(central + 42, true)
    view.setUint32(local + 22, 32 * 1024 * 1024, true)
    view.setUint32(central + 24, 32 * 1024 * 1024, true)
    expect(OoxmlPackage.read(bytes).get('word/bomb.xml')?.length).toBe(32 * 1024 * 1024)
  })

  it.each([0, 6] as const)('checks actual size and CRC for method level %s', (level) => {
    const bytes = plain('123456789', level)
    const { view, central } = headers(bytes)
    // The standard CRC-32 check vector independently verifies the table's polynomial/final xor.
    expect(view.getUint32(central + 16, true)).toBe(0xcbf43926)
    expect(OoxmlPackage.read(bytes).text('[Content_Types].xml')).toBe('123456789')
    view.setUint32(14, 1234, true)
    view.setUint32(central + 16, 1234, true)
    expect(() => OoxmlPackage.read(bytes)).toThrow(corrupt)
  })

  it.each([0, 6] as const)('refuses both overstated and understated real sizes at level %s', (level) => {
    for (const size of [8, 10]) {
      const bytes = plain('123456789', level)
      const { view, central } = headers(bytes)
      view.setUint32(22, size, true)
      view.setUint32(central + 24, size, true)
      expect(() => OoxmlPackage.read(bytes)).toThrow(corrupt)
    }
  })

  it.each(['local flags', 'local method', 'local crc', 'local compressed size', 'local original size', 'unsupported method'])(
    'rejects header disagreements: %s', (field) => {
      const bytes = plain()
      const { view, central } = headers(bytes)
      if (field === 'local flags') view.setUint16(6, 0x800, true)
      if (field === 'local method') view.setUint16(8, 0, true)
      if (field === 'local crc') view.setUint32(14, 0, true)
      if (field === 'local compressed size') view.setUint32(18, 1, true)
      if (field === 'local original size') view.setUint32(22, 1, true)
      if (field === 'unsupported method') { view.setUint16(8, 12, true); view.setUint16(central + 10, 12, true) }
      expect(() => OoxmlPackage.read(bytes)).toThrow(corrupt)
    },
  )

  it.each([1, 0x40, 0x2000])('rejects encryption flag %s in either header', (flag) => {
    for (const where of ['local', 'central', 'both']) {
      const bytes = plain()
      const { view, central } = headers(bytes)
      if (where !== 'central') view.setUint16(6, flag, true)
      if (where !== 'local') view.setUint16(central + 8, flag, true)
      expect(() => OoxmlPackage.read(bytes)).toThrow(expect.objectContaining({ code: 'encrypted' }))
    }
  })

  it.each(['count', 'offset', 'size', 'per-disk count'])('requires ZIP64 records for the %s sentinel', (field) => {
    const bytes = plain()
    const { view, end } = headers(bytes)
    if (field === 'count') view.setUint16(end + 10, 0xffff, true)
    if (field === 'per-disk count') view.setUint16(end + 8, 0xffff, true)
    if (field === 'size') view.setUint32(end + 12, 0xffffffff, true)
    if (field === 'offset') view.setUint32(end + 16, 0xffffffff, true)
    expect(() => OoxmlPackage.read(bytes)).toThrow(corrupt)
  })

  it.each(['locator offset', 'end length', 'classic count', 'zip64 count', 'directory offset', 'directory size', 'extra id', 'extra size', 'local size', 'central size', 'disk'])(
    'checks ZIP64 consistency: %s', (field) => {
      const bytes = fixture('valid-small-zip64.zip')
      const { view, end, locator, zip64, extra, localExtra } = headers(bytes)
      expect(zip64).toBeDefined()
      if (field === 'locator offset') view.setBigUint64(locator + 8, 1n, true)
      if (field === 'end length') view.setBigUint64(zip64! + 4, 43n, true)
      if (field === 'classic count') view.setUint16(end + 10, 1, true)
      if (field === 'zip64 count') view.setBigUint64(zip64! + 24, 1n, true)
      if (field === 'directory offset') view.setBigUint64(zip64! + 48, 1n, true)
      if (field === 'directory size') view.setBigUint64(zip64! + 40, 1n, true)
      if (field === 'extra id') view.setUint16(extra, 2, true)
      if (field === 'extra size') view.setUint16(extra + 2, 8, true)
      if (field === 'local size') view.setBigUint64(localExtra + 4, 1n, true)
      if (field === 'central size') view.setBigUint64(extra + 4, 1n, true)
      if (field === 'disk') view.setUint32(locator + 16, 2, true)
      expect(() => OoxmlPackage.read(bytes)).toThrow(corrupt)
    },
  )

  it('honors ZIP64 entry-count and expansion limits', () => {
    const bytes = fixture('valid-small-zip64.zip')
    expect(() => OoxmlPackage.read(bytes, { maxEntries: 1, maxUncompressedBytes: 1000 })).toThrow(expect.objectContaining({ code: 'too_large' }))
    expect(() => OoxmlPackage.read(bytes, { maxEntries: 10, maxUncompressedBytes: 80 })).toThrow(expect.objectContaining({ code: 'too_large' }))
  })

  it('accepts ZIP64 end-record sentinels only when they resolve consistently', () => {
    const bytes = fixture('valid-small-zip64.zip')
    const { view, end } = headers(bytes)
    for (const at of [4, 6, 8, 10]) view.setUint16(end + at, 0xffff, true)
    for (const at of [12, 16]) view.setUint32(end + at, 0xffffffff, true)
    expect(OoxmlPackage.read(bytes).paths()).toEqual(['[Content_Types].xml', 'word/document.xml'])
  })

  it.each(['python-descriptor.zip', 'python-stored-descriptor.zip', 'python-zip64-descriptor.zip'])(
    'validates descriptors in %s', (name) => {
      const bytes = fixture(name)
      expect(OoxmlPackage.read(bytes).text('[Content_Types].xml')).toContain('<Types')
      const { view, central, localExtra } = headers(bytes)
      const start = localExtra + view.getUint16(28, true)
      const compressed = name.includes('zip64') ? Number(view.getBigUint64(central + 46 + view.getUint16(central + 28, true) + 12, true)) : view.getUint32(central + 20, true)
      const descriptor = start + compressed
      expect(view.getUint32(descriptor, true)).toBe(0x08074b50)
      // Descriptors must agree on all three values, including when local sizes are placeholders.
      for (const at of [4, 8, name.includes('zip64') ? 16 : 12]) {
        const changed = bytes.slice()
        changed[descriptor + at] = changed[descriptor + at]! ^ 1
        expect(() => OoxmlPackage.read(changed)).toThrow(corrupt)
      }
    },
  )

  it.each([false, true])('accepts an unsigned descriptor (ZIP64: %s)', (zip64) => {
    const bytes = fixture(zip64 ? 'python-zip64-descriptor.zip' : 'python-descriptor.zip')
    const { central, zip64: zipEnd } = headers(bytes)
    const descriptor = central - (zip64 ? 24 : 16)
    const withoutSignature = new Uint8Array(bytes.length - 4)
    withoutSignature.set(bytes.subarray(0, descriptor))
    withoutSignature.set(bytes.subarray(descriptor + 4), descriptor)
    const modified = new DataView(withoutSignature.buffer)
    modified.setUint32(withoutSignature.length - 6, central - 4, true)
    if (zipEnd !== undefined) {
      modified.setBigUint64(zipEnd - 4 + 48, BigInt(central - 4), true)
      modified.setBigUint64(withoutSignature.length - 22 - 20 + 8, BigInt(zipEnd - 4), true)
    }
    expect(OoxmlPackage.read(withoutSignature).text('[Content_Types].xml')).toContain('<Types')
  })

  it('tries the unsigned ZIP64 layout when the CRC and compressed size equal the descriptor signature', () => {
    // Exact descriptor and following local-header signature from the 134 MiB review input.
    // Test the production parser with this 24-byte slice so every suite run need not allocate
    // hundreds of MiB for a stored payload just to reach these ambiguous descriptor bytes.
    const bytes = fixture('unsigned-zip64-crc-signature.bin')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const signature = 0x08074b50
    expect(view.getBigUint64(16, true)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
    expect(zipDescriptorEnd(view, 0, bytes.length, true, signature, signature, signature)).toBe(20)
    // A mismatch in the valid unsigned candidate must still be refused after both attempts.
    view.setUint32(12, signature + 1, true)
    expect(() => zipDescriptorEnd(view, 0, bytes.length, true, signature, signature, signature)).toThrow(corrupt)
  })

  it('accepts a local ZIP64 field without ZIP64 end records', () => {
    expect(OoxmlPackage.read(fixture('python-local-zip64.zip')).text('[Content_Types].xml')).toContain('<Types')
  })

  it('checks redundant local ZIP64 sizes as well as sentinel sizes', () => {
    const bytes = fixture('python-local-zip64.zip')
    const { view, localExtra } = headers(bytes)
    const size = Number(view.getBigUint64(localExtra + 4, true))
    // The local extra field still carries both sizes if just the compressed size is a sentinel.
    view.setUint32(22, size, true)
    expect(OoxmlPackage.read(bytes).text('[Content_Types].xml')).toContain('<Types')
    view.setUint32(22, size + 1, true)
    expect(() => OoxmlPackage.read(bytes)).toThrow(corrupt)
  })

  it('counts actual output cumulatively across parts and validates directories too', () => {
    const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'other.xml': strToU8('123456789'), 'folder/': new Uint8Array() })
    expect(() => OoxmlPackage.read(bytes, { maxEntries: 3, maxUncompressedBytes: 16 })).toThrow(expect.objectContaining({ code: 'too_large' }))
    expect(OoxmlPackage.read(bytes, { maxEntries: 3, maxUncompressedBytes: 17 }).paths()).toEqual(['[Content_Types].xml', 'other.xml'])
    expect(() => OoxmlPackage.read(bytes, { maxEntries: 2, maxUncompressedBytes: 17 })).toThrow(expect.objectContaining({ code: 'too_large' }))
  })

  it('rejects truncated records with format errors rather than DataView exceptions', () => {
    const bytes = fixture('valid-small-zip64.zip')
    for (let end = 2; end < bytes.length; end++) expect(() => OoxmlPackage.read(bytes.subarray(0, end))).toThrow(corrupt)
  })

  it('rejects missing final blocks and trailing compressed bytes', () => {
    // A non-final, stored deflate block can contain every expected output byte and CRC while
    // still being a truncated stream. fflate alone accepts it if the final input is empty.
    const bytes = plain('123456789', 0)
    const { view, central } = headers(bytes)
    const start = 30 + view.getUint16(26, true)
    const nonfinal = new Uint8Array([0, 9, 0, 246, 255, ...strToU8('123456789')])
    const trailing = new Uint8Array([1, 9, 0, 246, 255, ...strToU8('123456789'), 0])
    for (const stream of [nonfinal, trailing]) {
      const changed = new Uint8Array(bytes.length - 9 + stream.length)
      changed.set(bytes.subarray(0, start))
      changed.set(stream, start)
      changed.set(bytes.subarray(start + 9), start + stream.length)
      const updated = new DataView(changed.buffer)
      const newCentral = central - 9 + stream.length
      updated.setUint16(8, 8, true)
      updated.setUint16(newCentral + 10, 8, true)
      updated.setUint32(18, stream.length, true)
      updated.setUint32(newCentral + 20, stream.length, true)
      updated.setUint32(changed.length - 6, newCentral, true)
      expect(() => OoxmlPackage.read(changed)).toThrow(corrupt)
    }
  })

  it('handles Uint8Array subviews without reading the surrounding buffer', () => {
    const bytes = fixture('valid-small-zip64.zip')
    const padded = new Uint8Array(bytes.length + 20)
    padded.set(bytes, 10)
    expect(OoxmlPackage.read(padded.subarray(10, -10)).paths()).toEqual(OoxmlPackage.read(bytes).paths())
  })

  it('preserves directory ordering even when local headers are in another order', () => {
    const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'other.xml': strToU8('<other/>') })
    const { view, central, end } = headers(bytes)
    const next = central + 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true)
    const first = bytes.slice(central, next)
    const second = bytes.slice(next, end)
    bytes.set(second, central)
    bytes.set(first, central + second.length)
    const pkg = OoxmlPackage.read(bytes)
    expect(pkg.paths()).toEqual(['other.xml', '[Content_Types].xml'])
    expect(OoxmlPackage.read(pkg.write()).paths()).toEqual(['[Content_Types].xml', 'other.xml'])
  })
})

/**
 * Byte equality without walking every element through `toEqual`, which takes seconds on parts of
 * a few hundred kilobytes and timed out on slower CI runners. The message names what differs.
 */
function expectSameBytes(actual: Uint8Array | undefined, expected: Uint8Array | undefined, label: string) {
  expect(actual, `${label} is missing`).toBeDefined()
  expect(expected, `${label} is not expected`).toBeDefined()
  expect(Buffer.from(actual!).equals(Buffer.from(expected!)), `${label} differs (${actual!.byteLength} vs ${expected!.byteLength} bytes)`).toBe(true)
}

for (const producer of ['office', 'libreoffice', 'python', 'zip64']) {
  describe(`${producer} Office compatibility`, () => {
    it.each(['docx', 'xlsx', 'pptx'])('preserves every part of %s through inspection and round trip', (extension) => {
      const bytes = fixture(`${producer}.${extension}`)
      const expected = unzipSync(bytes)
      const pkg = OoxmlPackage.read(bytes)
      expect(pkg.mainPart()).toBeDefined()
      for (const path of pkg.paths()) {
        pkg.contentType(path)
        if (/\.(xml|rels)$/.test(path)) pkg.xml(path)
        expectSameBytes(pkg.get(path), expected[path], path)
      }
      expect(pkg.paths()).toEqual(Object.keys(expected).filter((path) => !path.endsWith('/')))
      const written = pkg.write()
      const roundTrip = OoxmlPackage.read(written)
      expect(roundTrip.paths()[0]).toBe('[Content_Types].xml')
      for (const path of pkg.paths()) expectSameBytes(roundTrip.get(path), expected[path], `${path} after a round trip`)
      expectSameBytes(roundTrip.write(), written, 'the rewritten package')
    })
  })
}
