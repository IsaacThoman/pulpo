import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceTimeZone } from './time-zone.js'

afterEach(() => vi.restoreAllMocks())

describe('device timezone', () => {
  it('picks up device timezone changes on the next request', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValueOnce({ timeZone: 'America/New_York' } as Intl.ResolvedDateTimeFormatOptions)
      .mockReturnValueOnce({ timeZone: 'Asia/Tokyo' } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceTimeZone()).toBe('America/New_York')
    expect(deviceTimeZone()).toBe('Asia/Tokyo')
  })
  it('omits unavailable timezone instead of claiming UTC is local', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => { throw new Error('Unavailable') })
    expect(deviceTimeZone()).toBeUndefined()
  })
  it('omits invalid device timezone values', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: '+04:00' } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceTimeZone()).toBeUndefined()
  })
})
