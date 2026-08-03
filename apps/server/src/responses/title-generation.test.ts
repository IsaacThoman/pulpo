import { describe, expect, it } from 'vitest'
import { parseGeneratedTitle, selectTitleHistory } from './title-generation.js'

describe('selectTitleHistory', () => {
  it('returns the original history when the requested ends overlap', () => {
    const history = 'x'.repeat(200)
    expect(selectTitleHistory(history, 1_000, 1_000)).toBe(history)
  })

  it('includes the requested beginning and end when they do not overlap', () => {
    expect(selectTitleHistory('abcdefghij', 3, 2)).toBe('abc\n…\nij')
  })

  it('allows either end to be excluded', () => {
    expect(selectTitleHistory('abcdefghij', 0, 3)).toBe('hij')
    expect(selectTitleHistory('abcdefghij', 3, 0)).toBe('abc')
    expect(selectTitleHistory('abcdefghij', 0, 0)).toBe('')
  })
})

describe('parseGeneratedTitle', () => {
  it('extracts a title from the requested JSON response', () => {
    expect(parseGeneratedTitle('{ "title": "🐙 Pulpo Title Settings" }')).toBe('🐙 Pulpo Title Settings')
  })

  it('accepts JSON wrapped in a markdown fence', () => {
    expect(parseGeneratedTitle('```json\n{"title":"🧪 Test Chat"}\n```')).toBe('🧪 Test Chat')
  })

  it('rejects malformed or missing titles', () => {
    expect(parseGeneratedTitle('A plain title')).toBeNull()
    expect(parseGeneratedTitle('{"name":"Wrong property"}')).toBeNull()
  })
})
