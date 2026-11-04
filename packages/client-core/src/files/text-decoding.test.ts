import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeTextBytes, decodeUtf8Lossy, decodeUtf8Strict, decodeWindows1252 } from './text-decoding.js'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('decodeTextBytes', () => {
  it('reads UTF-8 with and without a byte order mark', () => {
    expect(decodeTextBytes(new TextEncoder().encode('Café,π'))).toEqual({ text: 'Café,π', encoding: 'utf-8', bom: false })
    expect(decodeTextBytes(bytes(0xef, 0xbb, 0xbf, 0x61))).toEqual({ text: 'a', encoding: 'utf-8', bom: true })
  })

  it('reads UTF-16 in both byte orders from its byte order mark', () => {
    expect(decodeTextBytes(bytes(0xff, 0xfe, 0x61, 0x00, 0xe9, 0x00))).toEqual({ text: 'aé', encoding: 'utf-16le', bom: true })
    expect(decodeTextBytes(bytes(0xfe, 0xff, 0x00, 0x61, 0x00, 0xe9))).toEqual({ text: 'aé', encoding: 'utf-16be', bom: true })
  })

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    // "Café – €5" as Excel saves it on Windows.
    const ansi = bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x80, 0x35)
    expect(decodeTextBytes(ansi)).toEqual({ text: 'Café – €5', encoding: 'windows-1252', bom: false })
  })

  it('keeps UTF-8 when a mostly UTF-8 file has a stray bad byte', () => {
    const good = new TextEncoder().encode('Café crème — 日本語 '.repeat(50))
    const damaged = new Uint8Array([...good.subarray(0, 100), 0xff, ...good.subarray(100)])
    const decoded = decodeTextBytes(damaged)
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.text).toContain('Café crème')
    expect(decoded.text).toContain('\uFFFD')
  })

  it('decodes large inputs without overflowing the call stack', () => {
    const large = new Uint8Array(1_000_000).fill(0xe9)
    expect(decodeTextBytes(large).text.length).toBe(1_000_000)
  })
})

describe('without TextDecoder', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('validates UTF-8 by hand', () => {
    vi.stubGlobal('TextDecoder', undefined)
    expect(decodeUtf8Strict(new TextEncoder().encode('añ€😀'))).toBe('añ€😀')
    expect(decodeUtf8Strict(bytes(0xc0, 0x80))).toBeNull() // overlong
    expect(decodeUtf8Strict(bytes(0xed, 0xa0, 0x80))).toBeNull() // surrogate
    expect(decodeUtf8Strict(bytes(0xe2, 0x82))).toBeNull() // truncated
    expect(decodeUtf8Strict(bytes(0xf5, 0x80, 0x80, 0x80))).toBeNull() // past U+10FFFF
    expect(decodeUtf8Lossy(bytes(0x61, 0xff, 0x62))).toBe('a\uFFFDb')
  })

  it('maps every Windows-1252 byte', () => {
    const all = new Uint8Array(256).map((_, index) => index)
    expect(decodeWindows1252(all).length).toBe(256)
    expect(decodeWindows1252(bytes(0x93, 0x94))).toBe('“”')
  })
})
