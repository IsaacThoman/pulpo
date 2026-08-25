// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from './index'

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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { I18nBridge } = await import('./I18nBridge')
const { useSettings } = await import('@/stores/settings')

describe('I18nBridge', () => {
  afterEach(async () => {
    act(() => useSettings.getState().set('language', 'en-US'))
    await i18n.changeLanguage('en-US')
  })

  it('switches the active catalog when the language setting changes', async () => {
    render(<I18nBridge />)

    act(() => useSettings.getState().set('language', 'es-ES'))

    await waitFor(() => expect(i18n.resolvedLanguage).toBe('es-ES'))
    expect(i18n.t('settings.general.language')).toBe('Idioma')
    expect(document.documentElement.lang).toBe('es-ES')
  })
})
