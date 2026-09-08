// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ platform: 'android', preview: vi.fn(), speech: { modelId: 'first', models: {} as Record<string, { voice?: string; instructions: string; speed: number }> }, set: vi.fn() }))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityRole, accessibilityLabel, accessibilityState }: { children: ReactNode; onPress: () => void; accessibilityRole: string; accessibilityLabel?: string; accessibilityState?: { checked?: boolean; expanded?: boolean } }) => createElement('button', { role: accessibilityRole, 'aria-label': accessibilityLabel, 'aria-checked': accessibilityState?.checked, 'aria-expanded': accessibilityState?.expanded, onClick: onPress }, children),
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
vi.mock('../../store/preferences', () => ({ usePreferencesStore: (selector: (state: unknown) => unknown) => selector({ speech: mocks.speech }) }))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({ usePrototypeStore: (selector: (state: unknown) => unknown) => selector({ setPreference: mocks.set }) }))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, instanceUrl: 'test' }) }))
vi.mock('../../api/client', () => ({ apiRequest: async () => ({ data: [
  { id: 'first', name: 'First model', defaultVoice: 'coral', voices: [{ id: 'coral', label: 'Coral', previewAvailable: true }, { id: 'alloy', label: 'Alloy' }] },
  { id: 'second', name: 'Second model', defaultVoice: 'other', voices: [{ id: 'other', label: 'Other' }] },
] }) }))
vi.mock('./playback', async () => ({ speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeechVoice: mocks.preview }))
import { SpeechSettings } from './SpeechSettings'
import { speechPlayback } from './playback'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { speechPlayback.stop(); vi.clearAllMocks() })

it.each(['ios', 'android'])('keeps %s model selection separate from voice selection and previewing', async platform => {
  mocks.platform = platform
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(<QueryClientProvider client={client}><SpeechSettings onBack={() => {}} /></QueryClientProvider>)
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(container.querySelector('summary')?.textContent).toBe('First model')
  const trigger = container.querySelector('[aria-label="Voice: Coral"]') as HTMLButtonElement
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelectorAll('[role=radio]')).toHaveLength(0)
  await act(async () => trigger.click())
  expect(container.querySelectorAll('[role=radio]')).toHaveLength(2)
  await act(async () => { (container.querySelector('[aria-label="Preview Coral"]') as HTMLButtonElement).click() })
  expect(mocks.preview).toHaveBeenCalledWith('first', 'coral'); expect(mocks.set).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-label="Preview Alloy"]')).toBeNull()
  await act(async () => { (container.querySelector('[role=radio][aria-label="Alloy"]') as HTMLButtonElement).click() })
  expect(mocks.set).toHaveBeenLastCalledWith('speech', { modelId: 'first', models: { first: { voice: 'alloy', instructions: '', speed: 1 } } })
  expect(container.querySelectorAll('[role=radio]')).toHaveLength(0)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  await act(async () => trigger.click())
  let preview: Promise<void> | undefined
  await act(async () => { preview = speechPlayback.start('preview:first:coral', ['clip'], async () => ({ dispose() {}, play: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve())) })) })
  await act(async () => trigger.click()); await preview
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  expect(container.querySelectorAll('[role=radio]')).toHaveLength(0)
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Second model')!.click() })
  expect(mocks.set).toHaveBeenLastCalledWith('speech', { modelId: 'second', models: {} })
  let run: Promise<void> | undefined
  await act(async () => { run = speechPlayback.start('preview:first:coral', ['clip'], async () => ({ dispose() {}, play: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve())) })) })
  await act(async () => root.unmount()); await run
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  client.clear(); container.remove()
})
