// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ platform: 'android', preview: vi.fn(), saved: new Map<string, unknown>() }))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } }, Appearance: { setColorScheme: vi.fn() },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel?: string }) => createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress }, children),
  TextInput: () => null, ActivityIndicator: () => null,
}))
vi.mock('@expo/ui/swift-ui', () => {
  const Container = ({ children }: { children: ReactNode }) => createElement('div', null, children)
  return {
    Host: Container, HStack: Container, Section: Container, Spacer: () => null, Image: () => null,
    Menu: ({ label, children, modifiers }: { label: ReactNode; children: ReactNode; modifiers: Array<{ disabled?: boolean }> }) => createElement('details', { 'data-disabled': modifiers.some(m => m.disabled) }, createElement('summary', null, label), children),
    Text: ({ children, modifiers }: { children: ReactNode; modifiers?: Array<{ tag?: string }> }) => {
      const tagged = modifiers?.find(m => 'tag' in m)
      return tagged ? createElement('option', { value: tagged.tag }, children) : createElement('span', null, children)
    },
    Picker: ({ label, selection, onSelectionChange, children }: { label: string; selection: string; onSelectionChange: (id: string) => void; children: ReactNode }) => createElement('select', { 'aria-label': label, value: selection, onChange: (event: { target: { value: string } }) => onSelectionChange(event.target.value) }, children),
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  }
})
vi.mock('@expo/ui/swift-ui/modifiers', () => ({
  ...Object.fromEntries(['accessibilityLabel', 'buttonStyle', 'foregroundStyle', 'frame', 'lineLimit', 'pickerStyle'].map(name => [name, () => ({})])),
  tag: (tag: string) => ({ tag }), disabled: (disabled = true) => ({ disabled }),
}))
vi.mock('../../platform/MaterialUI', () => ({ MaterialMenu: ({ text, label, disabled, sections }: { text: string; label: string; disabled: boolean; sections: Array<{ actions: Array<{ id: string; label: string; selected?: boolean; onPress: () => void }> }> }) => createElement('details', { 'aria-label': label, 'data-disabled': disabled }, createElement('summary', null, text), ...sections.flatMap((section, index) => section.actions.map(action => createElement('button', { key: `${index}:${action.id}`, role: index === 0 ? 'menuitemradio' : 'button', 'aria-checked': action.selected, onClick: action.onPress }, action.label)))) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Screen: ({ children }: { children: ReactNode }) => createElement('div', null, children), PageHeader: () => null,
  GlassIconButton: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { 'aria-label': label, onClick: onPress }, label),
}))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({}) }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }))
vi.mock('../../data/database', () => ({
  getValue: async (namespace: string, key: string) => mocks.saved.get(`${namespace}:${key}`),
  setValue: async (namespace: string, key: string, value: unknown) => { mocks.saved.set(`${namespace}:${key}`, value) },
}))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, instanceUrl: 'test' }) }))
vi.mock('../../api/client', () => ({ apiRequest: async () => ({ data: [
  { id: 'first', name: 'First model', defaultVoice: 'coral', voices: [{ id: 'coral', label: 'Coral', previewAvailable: true }, { id: 'alloy', label: 'Alloy' }] },
  { id: 'second', name: 'Second model', defaultVoice: 'other', voices: [{ id: 'other', label: 'Other' }] },
] }) }))
vi.mock('./playback', async () => ({ speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeechVoice: mocks.preview }))
import { SpeechSettings } from './SpeechSettings'
import { speechPlayback } from './playback'
import { usePreferencesStore } from '../../store/preferences'
import { defaultPreferences } from '../../store/preferenceMapping'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { createInitialState } from '../../mockup5/src/initialState'
import { configureProductionActions } from '../../mockup5/src/production/productionActions'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement, root: Root, client: QueryClient
const persist = vi.fn((key: keyof typeof defaultPreferences, value: (typeof defaultPreferences)[keyof typeof defaultPreferences]) => usePreferencesStore.getState().setPreference(key, value))
beforeEach(() => {
  mocks.saved.clear()
  usePreferencesStore.setState({ ...defaultPreferences, pendingServerPreferenceKeys: [] })
  usePrototypeStore.setState(createInitialState())
  configureProductionActions({ setPreference: persist })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => { root.unmount(); speechPlayback.stop() })
  client.clear(); container.remove(); vi.clearAllMocks()
})
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><SpeechSettings onBack={() => {}} /></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
async function choose(label: string, id: string, text: string) {
  if (mocks.platform === 'ios') {
    const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    expect(select).not.toBeNull()
    await act(async () => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })) })
  } else await click(text)
}
function selected(label: string, id: string, text: string) {
  if (mocks.platform === 'ios') expect((container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement).value).toBe(id)
  else expect([...container.querySelectorAll('[role=menuitemradio][aria-checked=true]')].some(button => button.textContent === text)).toBe(true)
  expect([...container.querySelectorAll('summary')].some(summary => summary.textContent === text)).toBe(true)
}
async function startPreview() {
  await act(async () => { void speechPlayback.start('preview:first:coral', ['clip'], async () => ({ dispose() {}, play: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve())) })) })
}

it.each(['ios', 'android'])('persists %s model and voice choices, updates native selections, and restores them after hydration', async platform => {
  mocks.platform = platform
  await render()
  expect(container.textContent).toContain('Choose a model')
  await choose('Model', 'first', 'First model')
  selected('Model', 'first', 'First model'); selected('Voice', 'coral', 'Coral')
  expect(persist).toHaveBeenCalledWith('speech', { modelId: 'first', models: {} })
  await click('Preview Coral')
  expect(mocks.preview).toHaveBeenCalledWith('first', 'coral'); expect(persist).toHaveBeenCalledTimes(1)
  expect(container.textContent).not.toContain('Preview Alloy')
  await startPreview()
  await choose('Voice', 'alloy', 'Alloy')
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  selected('Voice', 'alloy', 'Alloy')
  const saved = { modelId: 'first', models: { first: { voice: 'alloy', instructions: '', speed: 1 } } }
  expect(usePreferencesStore.getState().speech).toEqual(saved)
  await choose('Model', 'second', 'Second model')
  selected('Voice', 'other', 'Other')
  await choose('Model', 'first', 'First model')
  selected('Voice', 'alloy', 'Alloy')
  await act(async () => {
    usePreferencesStore.setState({ speech: defaultPreferences.speech })
    await usePreferencesStore.getState().hydrate()
  })
  expect(usePreferencesStore.getState().speech).toEqual(saved)
  selected('Model', 'first', 'First model'); selected('Voice', 'alloy', 'Alloy')
})

it.each(['ios', 'android'])('stops %s previews explicitly, on model changes, and on leaving settings', async platform => {
  mocks.platform = platform
  await render(); await choose('Model', 'first', 'First model')
  await startPreview(); await click('Stop preview')
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  await startPreview(); await choose('Model', 'second', 'Second model')
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  await choose('Model', 'first', 'First model'); await startPreview()
  await act(async () => root.unmount())
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
})

it.each(['ios', 'android'])('lets %s replace unavailable models and voices without silently selecting a fallback', async platform => {
  mocks.platform = platform
  usePreferencesStore.setState({ speech: { modelId: 'removed', models: { first: { voice: 'removed', instructions: 'Calm', speed: 1.2 } } } })
  await render()
  expect(container.textContent).toContain('Selected model unavailable')
  expect(persist).not.toHaveBeenCalled()
  await choose('Model', 'first', 'First model')
  expect(container.textContent).toContain('Selected voice unavailable')
  await choose('Voice', 'coral', 'Coral')
  selected('Voice', 'coral', 'Coral')
  expect(usePreferencesStore.getState().speech.models.first).toEqual({ voice: 'coral', instructions: 'Calm', speed: 1.2 })
})
