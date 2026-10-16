import { describe, expect, it } from 'vitest'
import { EMPTY_BANNER_DRAFT, bannerDraftError, bannerInputFromDraft, bannerStatus } from './banners-logic'

const now = Date.parse('2026-10-16T12:00:00.000Z')

describe('bannerStatus', () => {
  it('matches the public banner window', () => {
    expect(bannerStatus({ startsAt: null, endsAt: null }, now)).toBe('active')
    expect(bannerStatus({ startsAt: '2026-10-17T00:00:00.000Z', endsAt: null }, now)).toBe('scheduled')
    expect(bannerStatus({ startsAt: null, endsAt: '2026-10-16T11:00:00.000Z' }, now)).toBe('expired')
    expect(bannerStatus({ startsAt: '2026-10-16T11:00:00.000Z', endsAt: '2026-10-16T13:00:00.000Z' }, now)).toBe('active')
  })
})

describe('banner drafts', () => {
  it('requires a message', () => {
    expect(bannerDraftError(EMPTY_BANNER_DRAFT)).toBe('content-required')
    expect(bannerDraftError({ ...EMPTY_BANNER_DRAFT, content: '   ' })).toBe('content-required')
    expect(bannerDraftError({ ...EMPTY_BANNER_DRAFT, content: 'x'.repeat(2_001) })).toBe('content-too-long')
  })

  it('rejects a window that ends before it starts', () => {
    const draft = { ...EMPTY_BANNER_DRAFT, content: 'Maintenance', startsAt: '2026-10-18T10:00', endsAt: '2026-10-18T09:00' }
    expect(bannerDraftError(draft)).toBe('invalid-window')
    expect(bannerDraftError({ ...draft, endsAt: '2026-10-18T11:00' })).toBeNull()
  })

  it('trims the message and sends empty schedule fields as null', () => {
    expect(bannerInputFromDraft({ ...EMPTY_BANNER_DRAFT, content: '  Hello  ' })).toEqual({
      type: 'info', content: 'Hello', dismissible: true, startsAt: null, endsAt: null,
    })
  })
})
