import { describe, expect, it } from 'vitest'
import { decodeTextFile, encodeTextFile } from './encoding.js'

describe('chunked byte-to-string decoding', () => {
  it.each(['utf-16le', 'utf-16be', 'windows-1252'] as const)('decodes large %s files exactly across chunk boundaries', (encoding) => {
    const text = 'A long line with café and € symbols.\n'.repeat(5_000)
    expect(text.length).toBeGreaterThan(150_000)
    const bytes = encodeTextFile(text, encoding, 'lf')
    expect(decodeTextFile(bytes)).toEqual({ text, encoding, lineEnding: 'lf', mixed: false })
  })

  it('keeps a surrogate pair split across UTF-16 chunks', () => {
    const text = 'a'.repeat(8_191) + '🐙' + 'b'.repeat(150_000)
    expect(decodeTextFile(encodeTextFile(text, 'utf-16le', 'lf')).text).toBe(text)
  })
})
