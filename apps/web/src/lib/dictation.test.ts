import { describe, expect, it } from 'vitest'
import { dictationFilename, formatDictationTime, insertDictationText } from './dictation'

describe('dictation helpers', () => {
  it('inserts a transcript at the cursor without damaging the draft', () => {
    expect(insertDictationText('hello world', 'brave new', 5)).toEqual({ value: 'hello brave new world', cursor: 15 })
    expect(insertDictationText('replace this please', 'that', 8, 12)).toEqual({ value: 'replace that please', cursor: 12 })
  })

  it('preserves whitespace and chooses a browser-compatible extension', () => {
    expect(insertDictationText('hello ', ' world ', 6)).toEqual({ value: 'hello world', cursor: 11 })
    expect(dictationFilename('audio/mp4')).toBe('dictation.m4a')
    expect(dictationFilename('audio/webm;codecs=opus')).toBe('dictation.webm')
  })

  it('formats elapsed recording time without rounding up', () => {
    expect(formatDictationTime(0)).toBe('0:00')
    expect(formatDictationTime(5_999)).toBe('0:05')
    expect(formatDictationTime(65_200)).toBe('1:05')
  })
})
