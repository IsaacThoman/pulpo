// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissBanner, pruneDismissedBannerIds, readDismissedBannerIds } from './banner-dismissals'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  clear: () => storage.clear(),
})

afterEach(() => localStorage.clear())

describe('banner dismissals', () => {
  it('remembers dismissed banners across reads', () => {
    dismissBanner('a')
    dismissBanner('b')
    dismissBanner('a')
    expect([...readDismissedBannerIds()]).toEqual(['a', 'b'])
  })

  it('ignores malformed storage', () => {
    localStorage.setItem('pulpo.banners.dismissed', '{not json')
    expect(readDismissedBannerIds().size).toBe(0)
    localStorage.setItem('pulpo.banners.dismissed', JSON.stringify(['a', 4, null]))
    expect([...readDismissedBannerIds()]).toEqual(['a'])
  })

  it('forgets dismissals for banners that are no longer served', () => {
    dismissBanner('gone')
    dismissBanner('kept')
    pruneDismissedBannerIds(['kept', 'new'])
    expect([...readDismissedBannerIds()]).toEqual(['kept'])
  })
})
