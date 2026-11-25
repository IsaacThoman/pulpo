// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type SearchAppearance } from './api'
import { searchColorScheme, useSearchAppearance } from './appearance'
import { searchPalette } from './theme-palette'
import { loadPreferences, savePreferences } from './preferences'

const lagoon: SearchAppearance = {
  theme: 'dark',
  colorTheme: 'lagoon',
  customTheme: {
    id: 'lagoon',
    name: 'Lagoon',
    light: { colors: { 'editor.background': '#e8fdff' }, tokenColors: [] },
    dark: { colors: { 'editor.background': '#102632', 'button.background': '#c1ffe4' }, tokenColors: [] },
    css: 'body { display: none }',
  },
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('Search appearance', () => {
  it('follows the account by default, with an independent browser override', () => {
    expect(searchColorScheme('pulpo', lagoon, false)).toBe('dark')
    expect(searchColorScheme('pulpo', undefined, true)).toBe('dark')
    expect(searchColorScheme('system', lagoon, false)).toBe('light')
    expect(searchColorScheme('light', lagoon, true)).toBe('light')
  })

  it('uses the selected palette, including instance palettes, with a graceful removed-theme fallback', () => {
    expect(searchPalette(lagoon, 'dark')).toMatchObject({ '--page': '#102632', '--accent': '#c1ffe4' })
    expect(searchPalette({ theme: 'dark', colorTheme: 'instance:lagoon', instanceTheme: lagoon.customTheme }, 'light'))
      .toMatchObject({ '--page': '#e8fdff' })
    expect(searchPalette({ theme: 'dark', colorTheme: 'removed' }, 'dark')).toEqual({})
  })

  it('refreshes on focus and clears account colors on sign-out', async () => {
    const load = vi.spyOn(api, 'appearance').mockResolvedValueOnce(lagoon).mockResolvedValue({
      theme: 'light', colorTheme: 'pulpo',
    })
    const { rerender } = renderHook(({ userId }: { userId?: string }) => useSearchAppearance(userId, 'pulpo'), {
      initialProps: { userId: 'test' as string | undefined },
    })
    const root = document.documentElement
    await waitFor(() => expect(root.dataset.theme).toBe('dark'))
    await waitFor(() => expect(root.style.getPropertyValue('--page')).toBe('#102632'))
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(root.dataset.theme).toBe('light'))
    expect(load).toHaveBeenCalledTimes(2)
    expect(root.style.getPropertyValue('--page')).toBe('')
    rerender({ userId: undefined })
    expect(root.style.getPropertyValue('--accent')).toBe('')
  })

  it('gives legacy defaults account inheritance and preserves new explicit system overrides', () => {
    window.localStorage.setItem('pulpo-search-settings-v1', JSON.stringify({ theme: 'system' }))
    expect(loadPreferences().theme).toBe('pulpo')
    savePreferences({ ...loadPreferences(), theme: 'system' })
    expect(loadPreferences().theme).toBe('system')
    window.localStorage.setItem('pulpo-search-settings-v1', JSON.stringify({ theme: 'dark' }))
    expect(loadPreferences().theme).toBe('dark')
  })
})
