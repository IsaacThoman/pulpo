import { describe, expect, it } from 'vitest'
import {
  DICTATION_WAVEFORM_SAMPLES,
  decibelsFromSamples,
  dictationNearsLimit,
  dictationWaveformBarCount,
  emptyDictationLevels,
  formatDictationElapsed,
  insertDictationText,
  normalizeDictationDecibels,
  pushDictationLevel,
} from './dictation.js'

describe('dictation helpers', () => {
  it('inserts a transcript at the cursor without damaging the draft', () => {
    expect(insertDictationText('hello world', 'brave new', 5)).toEqual({ value: 'hello brave new world', cursor: 15 })
    expect(insertDictationText('replace this please', 'that', 8, 12)).toEqual({ value: 'replace that please', cursor: 12 })
  })

  it('preserves whitespace and chooses a browser-compatible extension', () => {
    expect(insertDictationText('hello ', ' world ', 6)).toEqual({ value: 'hello world', cursor: 11 })
  })
})

describe('dictation waveform levels', () => {
  it('maps the noise floor to zero, full scale to one, and missing readings to silence', () => {
    expect(normalizeDictationDecibels(undefined)).toBe(0)
    expect(normalizeDictationDecibels(null)).toBe(0)
    expect(normalizeDictationDecibels(Number.NaN)).toBe(0)
    expect(normalizeDictationDecibels(-Infinity)).toBe(0)
    expect(normalizeDictationDecibels(-60)).toBe(0)
    expect(normalizeDictationDecibels(-120)).toBe(0)
    expect(normalizeDictationDecibels(0)).toBe(1)
    expect(normalizeDictationDecibels(6)).toBe(1)
    expect(normalizeDictationDecibels(Infinity)).toBe(1)
  })

  it('rises monotonically and keeps conversational speech clearly visible', () => {
    const levels = [-59, -50, -40, -30, -20, -10, -1].map(normalizeDictationDecibels)
    for (let index = 1; index < levels.length; index++) expect(levels[index]!).toBeGreaterThan(levels[index - 1]!)
    // Typical speech sits around -30…-15 dBFS; it should fill a meaningful share of the bar.
    expect(normalizeDictationDecibels(-30)).toBeGreaterThan(0.15)
    expect(normalizeDictationDecibels(-20)).toBeGreaterThan(0.3)
    expect(normalizeDictationDecibels(-20)).toBeLessThan(0.5)
  })

  it('measures RMS loudness of PCM samples in dBFS', () => {
    expect(decibelsFromSamples([])).toBe(-Infinity)
    expect(decibelsFromSamples(new Float32Array(128))).toBe(-Infinity)
    expect(decibelsFromSamples(new Float32Array(128).fill(1))).toBeCloseTo(0)
    expect(decibelsFromSamples(new Float32Array(128).fill(-0.1))).toBeCloseTo(-20)
    const sine = Float32Array.from({ length: 1024 }, (_, index) => Math.sin((index / 1024) * Math.PI * 16))
    expect(decibelsFromSamples(sine)).toBeCloseTo(-3.01, 1)
  })

  it('scrolls the history by one sample and clamps levels', () => {
    const empty = emptyDictationLevels(4)
    const once = pushDictationLevel(empty, 0.5)
    expect(once).toEqual([0, 0, 0, 0.5])
    expect(pushDictationLevel(once, 2)).toEqual([0, 0, 0.5, 1])
    expect(pushDictationLevel(once, -1)).toEqual([0, 0, 0.5, 0])
    expect(pushDictationLevel(once, Number.NaN)).toEqual([0, 0, 0.5, 0])
    expect(empty).toEqual([0, 0, 0, 0])
    expect(emptyDictationLevels()).toHaveLength(DICTATION_WAVEFORM_SAMPLES)
  })

  it('returns the same history while it stays silent', () => {
    const empty = emptyDictationLevels(4)
    expect(pushDictationLevel(empty, 0)).toBe(empty)
    const loud = pushDictationLevel(empty, 0.4)
    expect(pushDictationLevel(loud, 0)).not.toBe(loud)
  })

  it('covers the width plus one scrolling bar without exceeding the history', () => {
    expect(dictationWaveformBarCount(0)).toBe(2)
    expect(dictationWaveformBarCount(-10)).toBe(2)
    expect(dictationWaveformBarCount(49)).toBe(11)
    expect(dictationWaveformBarCount(200)).toBe(41)
    expect(dictationWaveformBarCount(5000)).toBe(DICTATION_WAVEFORM_SAMPLES)
    expect(dictationWaveformBarCount(5000, 128)).toBe(128)
  })

  it('formats elapsed time and flags the last ten seconds', () => {
    expect(formatDictationElapsed(0)).toBe('0:00')
    expect(formatDictationElapsed(9.9)).toBe('0:09')
    expect(formatDictationElapsed(75)).toBe('1:15')
    expect(formatDictationElapsed(-3)).toBe('0:00')
    expect(dictationNearsLimit(79)).toBe(false)
    expect(dictationNearsLimit(80)).toBe(true)
    expect(dictationNearsLimit(90)).toBe(true)
  })
})
