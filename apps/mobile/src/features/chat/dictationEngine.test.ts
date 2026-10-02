import { describe, expect, it } from 'vitest'
import { DICTATION_ENGINE_OPTIONS, dictationEngineFooter, resolveDictationEngine } from './dictationEngine'

const resolve = (overrides: Partial<Parameters<typeof resolveDictationEngine>[0]> = {}) => resolveDictationEngine({
  preference: 'server', serverAvailable: true, deviceAvailable: true, offline: false, ...overrides,
})

describe('dictation engine selection', () => {
  it('uses the server model by default when both are available', () => {
    expect(resolve()).toBe('server')
  })
  it('honours an on-device preference', () => {
    expect(resolve({ preference: 'device' })).toBe('device')
  })
  it('falls back to the device when the server has no dictation configured', () => {
    expect(resolve({ serverAvailable: false })).toBe('device')
  })
  it('falls back to the device while offline', () => {
    expect(resolve({ offline: true })).toBe('device')
  })
  it('keeps using the server where on-device transcription is unavailable', () => {
    expect(resolve({ deviceAvailable: false, preference: 'device' })).toBe('server')
    expect(resolve({ deviceAvailable: false, offline: true })).toBe('server')
  })
  it('disables dictation when neither engine is available', () => {
    expect(resolve({ deviceAvailable: false, serverAvailable: false })).toBeNull()
  })
})

describe('dictation engine setting copy', () => {
  it('lists the server first as the default choice', () => {
    expect(DICTATION_ENGINE_OPTIONS.map((option) => option.value)).toEqual(['server', 'device'])
  })
  it('explains the trade-off, or why the device is always used', () => {
    expect(dictationEngineFooter(true)).toContain('more accurate')
    expect(dictationEngineFooter(false)).toContain('always runs on this iPhone')
  })
})
