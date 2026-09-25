// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_CHANGE_EVENT } from '@/lib/profile-events'

const storage = new Map<string, string>()
let systemDark = false

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
  clear: () => storage.clear(),
})
vi.stubGlobal('matchMedia', () => ({ matches: systemDark, addEventListener: () => {}, removeEventListener: () => {} }))

let settings: typeof import('./settings')

beforeAll(async () => {
  settings = await import('./settings')
})

beforeEach(() => {
  storage.clear()
  systemDark = false
})

const isDark = () => document.documentElement.classList.contains('dark')

describe('theme while signed out', () => {
  it('ignores the saved theme and follows the system', () => {
    settings.applyTheme('dark')
    expect(isDark()).toBe(false)
    systemDark = true
    settings.applyTheme('light')
    expect(isDark()).toBe(true)
  })

  it('uses the saved theme once a profile is cached, and drops it again on sign-out', () => {
    settings.useSettings.setState({ theme: 'dark' })
    storage.set('pulpo-profile', '{"id":"u1"}')
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT))
    expect(isDark()).toBe(true)
    storage.delete('pulpo-profile')
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT))
    expect(isDark()).toBe(false)
  })
})
