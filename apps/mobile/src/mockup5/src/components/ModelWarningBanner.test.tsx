// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrototypeModel } from '../domain'

const mocks = vi.hoisted(() => ({
  markdown: { text: '', onLinkPress: undefined as ((url: string) => boolean) | undefined },
  state: {
    preferences: { showModelWarnings: true, modelWarningDismissals: {} as Record<string, { at: string; hash: string }> },
    models: [] as PrototypeModel[],
    setPreference: (() => undefined) as (key: string, value: unknown) => void,
  },
}))
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel: string }) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
}))
vi.mock('../../../components/SafeMarkdown', () => ({
  SafeMarkdown: ({ children, onLinkPress }: { children: string; onLinkPress?: (url: string) => boolean }) => {
    mocks.markdown = { text: children, onLinkPress }
    return createElement('p', null, children)
  },
}))
vi.mock('../../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../theme', () => ({ useAppTheme: () => ({ fillStrong: '#eee', secondary: '#666' }) }))
vi.mock('../store/prototypeStore', () => {
  const usePrototypeStore = (select: (state: typeof mocks.state) => unknown) => select(mocks.state)
  usePrototypeStore.getState = () => mocks.state
  return { usePrototypeStore }
})
import { ModelWarningBanner } from './ModelWarningBanner'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const opus = { id: 'opus', name: 'Opus', warningMessage: 'Opus uses limits faster', warningDismissDays: 30 } as PrototypeModel
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mocks.state.preferences = { showModelWarnings: true, modelWarningDismissals: {} }
  mocks.state.models = [opus]
  mocks.state.setPreference = vi.fn((key, value) => { mocks.state.preferences = { ...mocks.state.preferences, [key]: value } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('mobile model warning banner', () => {
  it('shows the selected model warning and records a synced dismissal', async () => {
    await act(async () => root.render(<ModelWarningBanner model={opus} />))
    expect(container.textContent).toContain('Opus uses limits faster')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss warning"]')!.click())
    expect(mocks.state.setPreference).toHaveBeenCalledWith('modelWarningDismissals', { opus: { at: expect.any(String), hash: expect.any(String) } })
    await act(async () => root.render(<ModelWarningBanner model={{ ...opus }} />))
    expect(container.textContent).toBe('')
  })

  it('stays hidden when the account setting is off or the model has no warning', async () => {
    mocks.state.preferences.showModelWarnings = false
    await act(async () => root.render(<ModelWarningBanner model={opus} />))
    expect(container.textContent).toBe('')
    mocks.state.preferences.showModelWarnings = true
    await act(async () => root.render(<ModelWarningBanner model={{ ...opus, warningMessage: '' }} />))
    expect(container.textContent).toBe('')
  })
})

describe('mobile model warning links', () => {
  it('switches to available models and unlinks unavailable ones', async () => {
    const onSelectModel = vi.fn()
    const linked = { ...opus, warningMessage: 'Try [Sonnet](model:sonnet) or [Retired](model:retired).' }
    mocks.state.models = [linked, { ...opus, id: 'sonnet', enabled: true }, { ...opus, id: 'retired', enabled: false }] as PrototypeModel[]
    await act(async () => root.render(<ModelWarningBanner model={linked} onSelectModel={onSelectModel} />))
    expect(mocks.markdown.text).toBe('Try [Sonnet](model:sonnet) or Retired.')
    expect(mocks.markdown.onLinkPress!('model:sonnet')).toBe(true)
    expect(onSelectModel).toHaveBeenCalledWith('sonnet')
    expect(mocks.markdown.onLinkPress!('model:retired')).toBe(true)
    expect(onSelectModel).toHaveBeenCalledTimes(1)
    expect(mocks.markdown.onLinkPress!('https://example.com')).toBe(false)
    expect(mocks.state.setPreference).not.toHaveBeenCalled()
  })
})
