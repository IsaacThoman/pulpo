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

describe('theme switching', () => {
  it('swaps the theme without leaving transitions disabled', () => {
    storage.set('pulpo-profile', '{"id":"u1"}')
    settings.applyTheme('light')
    const styles = document.head.querySelectorAll('style').length
    settings.applyTheme('dark')
    expect(isDark()).toBe(true)
    expect(document.head.querySelectorAll('style').length).toBe(styles)
  })
})

describe('color themes', () => {
  const themeStyle = () => document.getElementById('pulpo-color-theme')?.textContent ?? ''

  it('applies the selected theme only while signed in, and Pulpo adds nothing', () => {
    settings.useSettings.setState({ colorTheme: 'iris' })
    expect(themeStyle()).toBe('')
    storage.set('pulpo-profile', '{"id":"u1"}')
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT))
    expect(themeStyle()).toContain(':root.dark{--background:#1d1929;')
    settings.useSettings.setState({ colorTheme: 'pulpo' })
    expect(document.getElementById('pulpo-color-theme')).toBeNull()
    settings.useSettings.setState({ colorTheme: 'iris' })
    storage.delete('pulpo-profile')
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT))
    expect(document.getElementById('pulpo-color-theme')).toBeNull()
  })

  it('applies custom themes with their CSS and falls back to Pulpo for unknown ids', () => {
    storage.set('pulpo-profile', '{"id":"u1"}')
    settings.useSettings.setState({
      colorTheme: 'custom-a',
      customThemes: [{ id: 'custom-a', name: 'Mine', light: { colors: { 'button.background': '#ff0000' }, tokenColors: [] }, dark: { colors: {}, tokenColors: [] }, css: '.x { color: red }' }],
    })
    expect(themeStyle()).toContain('--primary:#ff0000;')
    expect(themeStyle()).toContain('.x { color: red }')
    settings.useSettings.setState({ colorTheme: 'custom-missing' })
    expect(document.getElementById('pulpo-color-theme')).toBeNull()
  })

  it('applies an instance palette once loaded and falls back when it is removed', () => {
    storage.set('pulpo-profile', '{"id":"u1"}')
    settings.useSettings.setState({ colorTheme: 'instance:lagoon' })
    expect(themeStyle()).toBe('')
    settings.useSettings.setState({
      instanceThemes: [{
        id: 'lagoon', name: 'Lagoon', css: '',
        light: { colors: { 'button.background': '#0e7490' }, tokenColors: [] },
        dark: { colors: {}, tokenColors: [] },
      }],
    })
    expect(themeStyle()).toContain('--primary:#0e7490;')
    expect(JSON.parse(storage.get('pulpo-settings')!).state).not.toHaveProperty('instanceThemes')
    settings.useSettings.setState({ instanceThemes: [] })
    expect(themeStyle()).toBe('')
  })
})
