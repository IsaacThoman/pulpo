// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

const storage = new Map<string, string>()

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener: () => undefined,
  }),
})

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
})

const { applyLanguage, DEFAULT_SETTINGS, normalizeLanguage } = await import('./settings')

describe('interface settings', () => {
  it('enables the double Shift search shortcut by default', () => {
    expect(DEFAULT_SETTINGS.doubleShiftSearch).toBe(true)
  })

  it('uses normal animation speed by default', () => {
    expect(DEFAULT_SETTINGS.animationSpeed).toBe(1)
  })

  it('hides response costs by default', () => {
    expect(DEFAULT_SETTINGS.showResponseCost).toBe(false)
  })
})

describe('language settings', () => {
  beforeEach(() => {
    document.documentElement.lang = ''
  })

  it('accepts only the supported English and Spanish locales', () => {
    expect(normalizeLanguage('en-US')).toBe('en-US')
    expect(normalizeLanguage('es-ES')).toBe('es-ES')
    expect(normalizeLanguage('de-DE')).toBe('en-US')
    expect(normalizeLanguage(undefined)).toBe('en-US')
  })

  it('applies the selected locale to the document', () => {
    applyLanguage('es-ES')
    expect(document.documentElement.lang).toBe('es-ES')
  })
})


it('enables collapsed messages for old settings and persists explicit opt-outs', async () => {
  const { useSettings } = await import('./settings')
  expect(DEFAULT_SETTINGS.collapseIntermediateMessages).toBe(true)
  storage.set('pulpo-settings', JSON.stringify({ state: { showReasoning: true }, version: 0 }))
  await useSettings.persist.rehydrate()
  expect(useSettings.getState().collapseIntermediateMessages).toBe(true)
  useSettings.getState().set('collapseIntermediateMessages', false)
  await useSettings.persist.rehydrate()
  expect(useSettings.getState().collapseIntermediateMessages).toBe(false)
})
