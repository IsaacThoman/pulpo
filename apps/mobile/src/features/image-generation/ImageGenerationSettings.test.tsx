// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ platform: 'android', preview: vi.fn(), imageGeneration: { enabled: false, modelId: 'first' as string | null }, set: vi.fn() }))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityRole, accessibilityLabel, accessibilityState }: { children: ReactNode; onPress: () => void; accessibilityRole: string; accessibilityLabel?: string; accessibilityState?: { checked?: boolean; expanded?: boolean } }) => createElement('button', { role: accessibilityRole, 'aria-label': accessibilityLabel, 'aria-checked': accessibilityState?.checked, 'aria-expanded': accessibilityState?.expanded, onClick: onPress }, children),
  Switch: ({ value, disabled, onValueChange, accessibilityLabel }: { value: boolean; disabled: boolean; onValueChange: (value: boolean) => void; accessibilityLabel: string }) => createElement('button', { role: 'switch', 'aria-label': accessibilityLabel, 'aria-checked': value, disabled, onClick: () => onValueChange(!value) }),
  TextInput: () => null, ActivityIndicator: () => null,
}))
vi.mock('@expo/ui/swift-ui', () => ({
  Host: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Menu: ({ label, children }: { label: ReactNode; children: ReactNode }) => createElement('details', null, createElement('summary', null, label), children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ buttonStyle: () => ({}), foregroundStyle: () => ({}) }))
vi.mock('../../platform/MaterialUI', () => ({ MaterialMenu: ({ text, actions }: { text: string; actions: Array<{ label: string; onPress: () => void }> }) => createElement('details', null, createElement('summary', null, text), ...actions.map(action => createElement('button', { key: action.label, onClick: action.onPress }, action.label))) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Screen: ({ children }: { children: ReactNode }) => createElement('div', null, children), PageHeader: () => null,
  GlassIconButton: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { 'aria-label': label, onClick: onPress }, label),
}))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({}) }))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: (selector: (state: unknown) => unknown) => selector({ imageGeneration: mocks.imageGeneration }) }))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({ usePrototypeStore: (selector: (state: unknown) => unknown) => selector({ setPreference: mocks.set }) }))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, instanceUrl: 'test' }) }))
vi.mock('../../api/client', () => ({ apiRequest: async () => ({ data: [
  { id: 'first', name: 'First model', defaultVoice: 'coral', voices: [{ id: 'coral', label: 'Coral', previewAvailable: true }, { id: 'alloy', label: 'Alloy' }] },
  { id: 'second', name: 'Second model', defaultVoice: 'other', voices: [{ id: 'other', label: 'Other' }] },
] }) }))
import { ImageGenerationSettings } from './ImageGenerationSettings'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.clearAllMocks() })
it.each(['ios', 'android'])('uses %s model controls and keeps opting in separate', async platform => {
  mocks.platform = platform; mocks.imageGeneration = { enabled: false, modelId: 'first' }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const render = () => root.render(<QueryClientProvider client={client}><ImageGenerationSettings onBack={() => {}} /></QueryClientProvider>)
  await act(async () => { render(); await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(container.querySelector('summary')?.textContent).toBe('First model')
  await act(async () => { (container.querySelector('[role=switch]') as HTMLButtonElement).click() })
  expect(mocks.set).toHaveBeenLastCalledWith('imageGeneration', { enabled: true, modelId: 'first' })
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Second model')!.click() })
  expect(mocks.set).toHaveBeenLastCalledWith('imageGeneration', { enabled: false, modelId: 'second' })
  mocks.imageGeneration = { enabled: false, modelId: 'missing' }
  await act(async () => { render() })
  expect(container.textContent).toContain('Selected model unavailable')
  expect((container.querySelector('[role=switch]') as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.imageGeneration.modelId).toBe('missing')
  await act(async () => root.unmount()); container.remove(); client.clear()
})
