import { describe, expect, it } from 'vitest'
import { activeModelWarning, dismissModelWarning, modelWarningHash } from './model-warnings.js'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-09-22T12:00:00.000Z')
const opus = { id: 'opus', warningMessage: 'Opus uses limits faster', warningDismissDays: 30 }

describe('model warnings', () => {
  it('hashes trimmed messages stably', () => {
    expect(modelWarningHash('  hello ')).toBe(modelWarningHash('hello'))
    expect(modelWarningHash('hello')).not.toBe(modelWarningHash('hello!'))
    expect(modelWarningHash('hello')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('shows only enabled, non-empty warnings', () => {
    expect(activeModelWarning(opus, {}, { enabled: true, now })).toBe('Opus uses limits faster')
    expect(activeModelWarning(opus, {}, { enabled: false, now })).toBeNull()
    expect(activeModelWarning({ id: 'haiku', warningMessage: '   ' }, {}, { enabled: true, now })).toBeNull()
    expect(activeModelWarning(undefined, {}, { enabled: true, now })).toBeNull()
  })

  it('hides a dismissed warning until the dismissal expires', () => {
    const dismissals = dismissModelWarning({}, opus, [opus], now)
    expect(activeModelWarning(opus, dismissals, { enabled: true, now: now + 29 * DAY })).toBeNull()
    expect(activeModelWarning(opus, dismissals, { enabled: true, now: now + 30 * DAY })).toBe(opus.warningMessage)
  })

  it('keeps zero-day dismissals forever', () => {
    const forever = { ...opus, warningDismissDays: 0 }
    const dismissals = dismissModelWarning({}, forever, [forever], now)
    expect(activeModelWarning(forever, dismissals, { enabled: true, now: now + 10_000 * DAY })).toBeNull()
  })

  it('shows an edited warning again', () => {
    const dismissals = dismissModelWarning({}, opus, [opus], now)
    const edited = { ...opus, warningMessage: 'Opus now costs more' }
    expect(activeModelWarning(edited, dismissals, { enabled: true, now })).toBe('Opus now costs more')
  })

  it('prunes stale dismissals for known models and keeps unknown ones', () => {
    const sonnet = { id: 'sonnet', warningMessage: 'Sonnet notice', warningDismissDays: 1 }
    const dismissals = {
      sonnet: { at: new Date(now - 2 * DAY).toISOString(), hash: modelWarningHash('Sonnet notice') },
      removed: { at: new Date(now - DAY).toISOString(), hash: 'deadbeef' },
      changed: { at: new Date(now).toISOString(), hash: 'deadbeef' },
    }
    const changed = { id: 'changed', warningMessage: 'Different text' }
    expect(Object.keys(dismissModelWarning(dismissals, opus, [opus, sonnet, changed], now)).sort())
      .toEqual(['opus', 'removed'])
  })
})
