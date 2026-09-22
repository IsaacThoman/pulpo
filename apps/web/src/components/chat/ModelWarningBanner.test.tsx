// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCatalog } from '@/stores/catalog'
import { DEFAULT_SETTINGS, useSettings } from '@/stores/settings'
import type { Model } from '@/lib/types'
import { ModelWarningBanner } from './ModelWarningBanner'

vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) }, configurable: true })
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true })
})

const opus = {
  id: 'opus', name: 'Opus', providerGroupId: 'anthropic', provider: 'Anthropic', inferenceProvider: 'Anthropic',
  labLogo: 'anthropic', modelLogo: 'anthropic', description: '', contextWindow: 200_000, tags: [],
  iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0, perMessagePrice: 0, enabled: true, presets: [],
  warningMessage: 'Opus uses limits **faster**. [Learn more](https://example.com)', warningDismissDays: 30,
} satisfies Model

beforeEach(() => {
  useCatalog.setState({ models: [opus, { ...opus, id: 'haiku', name: 'Haiku', warningMessage: '' }] })
  useSettings.setState({ ...DEFAULT_SETTINGS })
})
afterEach(cleanup)

it('renders the selected model warning as markdown', () => {
  render(<ModelWarningBanner modelId="opus" />)
  expect(screen.getByRole('note').textContent).toContain('Opus uses limits faster')
  expect(screen.getByRole('link', { name: 'Learn more' }).getAttribute('href')).toBe('https://example.com')
})

it('renders nothing for models without warnings or when disabled', () => {
  const { rerender } = render(<ModelWarningBanner modelId="haiku" />)
  expect(screen.queryByRole('note')).toBeNull()
  act(() => useSettings.getState().set('showModelWarnings', false))
  rerender(<ModelWarningBanner modelId="opus" />)
  expect(screen.queryByRole('note')).toBeNull()
})

it('records a synced dismissal and reappears when the text changes', () => {
  render(<ModelWarningBanner modelId="opus" />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }))
  expect(screen.queryByRole('note')).toBeNull()
  expect(useSettings.getState().modelWarningDismissals.opus).toMatchObject({ hash: expect.any(String) })
  act(() => useCatalog.setState({ models: [{ ...opus, warningMessage: 'New pricing applies' }] }))
  expect(screen.getByRole('note').textContent).toContain('New pricing applies')
})
