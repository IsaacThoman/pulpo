import { describe, expect, it } from 'vitest'
import { activeModelWarning, dismissModelWarning, modelLinkTarget, modelWarningHash, modelWarningLinkError, modelWarningLinkTargets, unlinkUnavailableModelLinks } from './model-warnings.js'

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

describe('model warning links', () => {
  it('reads model ids from model: links only', () => {
    expect(modelLinkTarget('model:sonnet')).toBe('sonnet')
    expect(modelLinkTarget(' MODEL:codex%3Agpt-5 ')).toBe('codex:gpt-5')
    expect(modelLinkTarget('https://example.com')).toBeNull()
    expect(modelLinkTarget('model:')).toBeNull()
    expect(modelLinkTarget('model:a/b')).toBeNull()
    expect(modelLinkTarget('model:%E0%A4%A')).toBeNull()
    expect(modelLinkTarget(undefined)).toBeNull()
  })

  it('collects inline, reference, nested, and autolinked model targets', () => {
    expect(modelWarningLinkTargets([
      'Try [Sonnet](model:sonnet) or **[Haiku](model:haiku "fast")**.',
      '- [again](model:sonnet)',
      'See [pricing](https://example.com) and [Mini][mini] or <model:nano>.',
      '',
      '[mini]: model:mini',
    ].join('\n')).sort()).toEqual(['haiku', 'mini', 'nano', 'sonnet'])
  })

  it('validates link targets against the enabled catalog', () => {
    const catalog = [{ id: 'opus', enabled: true }, { id: 'sonnet', enabled: true }, { id: 'retired', enabled: false }]
    expect(modelWarningLinkError('opus', 'See [pricing](https://example.com)', catalog)).toBeNull()
    expect(modelWarningLinkError('opus', '[Use Sonnet](model:sonnet)', catalog)).toBeNull()
    expect(modelWarningLinkError('opus', '[Stay](model:opus)', catalog)).toMatch(/own model/)
    expect(modelWarningLinkError('opus', '[Gone](model:missing)', catalog)).toMatch(/missing/)
    expect(modelWarningLinkError('opus', '[Old][old]\n\n[old]: model:retired', catalog)).toMatch(/retired/)
  })

  it('turns unavailable model links into plain labels', () => {
    const available = (id: string) => id === 'sonnet'
    expect(unlinkUnavailableModelLinks(
      'Use [Sonnet](model:sonnet), not **[Retired](model:retired)**, see [docs](https://example.com).',
      available,
    )).toBe('Use [Sonnet](model:sonnet), not **Retired**, see [docs](https://example.com).')
  })
})
