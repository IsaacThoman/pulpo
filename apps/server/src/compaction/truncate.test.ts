import { describe, expect, it } from 'vitest'
import { approxTokenCount, approxTokensFromBytes, truncateMiddleToTokens, utf8ByteLength } from './truncate.js'

describe('approximate token counts', () => {
  it('rounds UTF-8 bytes up to four-byte tokens', () => {
    expect(approxTokensFromBytes(0)).toBe(0)
    expect(approxTokensFromBytes(1)).toBe(1)
    expect(approxTokensFromBytes(4)).toBe(1)
    expect(approxTokensFromBytes(5)).toBe(2)
    expect(approxTokenCount('')).toBe(0)
    expect(approxTokenCount('abcd')).toBe(1)
    expect(approxTokenCount('abcde')).toBe(2)
  })

  it('counts bytes rather than UTF-16 code units', () => {
    expect(utf8ByteLength('😀')).toBe(4)
    expect(utf8ByteLength('é')).toBe(2)
    expect(approxTokenCount('😀😀')).toBe(2)
  })
})

describe('truncateMiddleToTokens', () => {
  it('returns text that fits unchanged', () => {
    expect(truncateMiddleToTokens('short output', 100)).toBe('short output')
    expect(truncateMiddleToTokens('abcd', 1)).toBe('abcd')
    expect(truncateMiddleToTokens('', 0)).toBe('')
  })

  it('replaces everything with the marker when the budget is zero', () => {
    expect(truncateMiddleToTokens('abcdef', 0)).toBe('…2 tokens truncated…')
  })

  it('keeps both ends and reports the removed tokens', () => {
    const text = `head${'x'.repeat(100)}tail`
    // 108 bytes, budget 16: keep 8 + 8 bytes, remove ceil(92 / 4) tokens.
    expect(truncateMiddleToTokens(text, 4)).toBe('headxxxx…23 tokens truncated…xxxxtail')
  })

  it('never splits a UTF-8 character', () => {
    expect(truncateMiddleToTokens('😀😀😀😀😀😀😀😀😀😀\nsecond line with text\n', 8))
      .toBe('😀😀😀😀…8 tokens truncated… line with text\n')
    expect(truncateMiddleToTokens('a😀b😀c', 1)).toBe('a…2 tokens truncated…c')
    expect(truncateMiddleToTokens('é中😀é', 1)).toBe('é…2 tokens truncated…é')
    expect(truncateMiddleToTokens('😀😀😀', 1)).toBe('…2 tokens truncated…')
  })

  it('adds no whitespace around the marker', () => {
    // 1,000 bytes, budget 64: 32 bytes per side, ceil(936 / 4) tokens removed.
    expect(truncateMiddleToTokens('word '.repeat(200), 16))
      .toBe(`${'word '.repeat(6)}wo…234 tokens truncated…d ${'word '.repeat(6)}`)
  })
})
