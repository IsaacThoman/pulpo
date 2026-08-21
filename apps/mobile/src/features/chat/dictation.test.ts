import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), append: vi.fn() }))
vi.mock('../../api/client', () => ({ apiRequest: mocks.apiRequest }))

import {
  DICTATION_AUDIO_BIT_RATE,
  DICTATION_AUDIO_SAMPLE_RATE,
  MAX_DICTATION_DURATION_SECONDS,
  insertDictationText,
  shouldApplyDictationResult,
  transcribeDictation,
} from './dictation'

describe('mobile dictation text insertion', () => {
  it('supports hour-long speech-focused recordings', () => {
    expect(MAX_DICTATION_DURATION_SECONDS).toBe(3_600)
    expect(DICTATION_AUDIO_BIT_RATE).toBe(32_000)
    expect(DICTATION_AUDIO_SAMPLE_RATE).toBe(16_000)
  })

  it('inserts into an empty draft', () => {
    expect(insertDictationText('', ' hello ', { start: 0, end: 0 })).toEqual({
      value: 'hello', selection: { start: 5, end: 5 },
    })
  })

  it('inserts at the cursor with normalized spacing', () => {
    expect(insertDictationText('hello world', 'brave new', { start: 5, end: 5 })).toEqual({
      value: 'hello brave new world', selection: { start: 15, end: 15 },
    })
  })

  it('replaces the selected text', () => {
    expect(insertDictationText('replace this please', 'that', { start: 8, end: 12 })).toEqual({
      value: 'replace that please', selection: { start: 12, end: 12 },
    })
  })

  it('does not duplicate surrounding whitespace', () => {
    expect(insertDictationText('hello  world', ' there ', { start: 6, end: 6 })).toEqual({
      value: 'hello there world', selection: { start: 11, end: 11 },
    })
  })

  it('leaves the draft unchanged for an empty transcript', () => {
    expect(insertDictationText('hello', '   ', { start: 99, end: 99 })).toEqual({
      value: 'hello', selection: { start: 5, end: 5 },
    })
  })

  it('rejects stale and cancelled transcription results', () => {
    expect(shouldApplyDictationResult(2, 3, false)).toBe(false)
    expect(shouldApplyDictationResult(3, 3, true)).toBe(false)
    expect(shouldApplyDictationResult(3, 3, false)).toBe(true)
  })
})

describe('mobile dictation upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    mocks.apiRequest.mockReset()
    mocks.append.mockReset()
  })

  it('uploads an authenticated m4a recording with the transcription timeout', async () => {
    class TestFormData {
      append = mocks.append
    }
    vi.stubGlobal('FormData', TestFormData)
    mocks.apiRequest.mockResolvedValue({ text: 'Transcribed draft' })
    const controller = new AbortController()

    await expect(transcribeDictation('file:///cache/recording.m4a', controller.signal))
      .resolves.toEqual({ text: 'Transcribed draft' })

    expect(mocks.append).toHaveBeenCalledWith('file', {
      uri: 'file:///cache/recording.m4a',
      name: 'dictation.m4a',
      type: 'audio/mp4',
    })
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/dictation/transcriptions', {
      method: 'POST',
      body: expect.any(TestFormData),
      signal: controller.signal,
      timeoutMs: 180_000,
    })
  })
})
