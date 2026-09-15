// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ platform: 'android', preview: vi.fn(), nativeWrites: vi.fn(), nativeText: null as null | { value: string }, saved: new Map<string, unknown>() }))
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
    Host: Container, HStack: Container, Section: Container, LabeledContent: Container, ProgressView: () => null,
    useNativeState: (value: string) => useRef({ value, get() { return this.value }, set(next: string) { mocks.nativeWrites(next); this.value = next } }).current,
    TextField: ({ text, onTextChange, onFocusChange }: { text: { value: string; get: () => string }; onTextChange: (text: string) => void; onFocusChange: (focused: boolean) => void }) => {
      mocks.nativeText = text
      return createElement('textarea', { 'aria-label': 'Speech instructions', value: text.get(), onFocus: () => onFocusChange(true), onBlur: () => onFocusChange(false), onChange: (event: { target: { value: string } }) => { text.value = event.target.value; onTextChange(event.target.value) } })
    },
    Stepper: ({ label, value, min, max, step, onValueChange }: { label: string; value: number; min: number; max: number; step: number; onValueChange: (value: number) => void }) => { expect([value, min, max, step].every(Number.isInteger)).toBe(true); return createElement('div', null, label, createElement('button', { disabled: value <= min, onClick: () => onValueChange(value - step) }, 'Decrease speech speed'), createElement('button', { disabled: value >= max, onClick: () => onValueChange(value + step) }, 'Increase speech speed')) },
    Spacer: () => null, Image: () => null,
    Menu: ({ label, children, modifiers }: { label: ReactNode; children: ReactNode; modifiers: Array<{ disabled?: boolean }> }) => createElement('details', { 'data-disabled': modifiers.some(m => m.disabled) }, createElement('summary', null, label), children),
    Text: ({ children, modifiers }: { children: ReactNode; modifiers?: Array<{ tag?: string }> }) => {
      const tagged = modifiers?.find(m => 'tag' in m)
      return tagged ? createElement('option', { value: tagged.tag }, children) : createElement('span', null, children)
    },
    Picker: ({ label, selection, onSelectionChange, children }: { label: string; selection: string; onSelectionChange: (id: string) => void; children: ReactNode }) => createElement('select', { 'aria-label': label, value: selection, onChange: (event: { target: { value: string } }) => onSelectionChange(event.target.value) }, children),
    Button: ({ label, onPress, modifiers = [] }: { label: string; onPress: () => void; modifiers?: Array<{ disabled?: boolean }> }) => createElement('button', { onClick: onPress, disabled: modifiers.some(m => m.disabled) }, label),
  }
})
vi.mock('@expo/ui/swift-ui/modifiers', () => ({
  ...Object.fromEntries(['accessibilityLabel', 'accessibilityValue', 'buttonStyle', 'foregroundStyle', 'frame', 'lineLimit', 'pickerStyle', 'textFieldStyle'].map(name => [name, () => ({})])),
  tag: (tag: string) => ({ tag }), disabled: (disabled = true) => ({ disabled }),
}))
vi.mock('../../platform/MaterialUI', () => ({ MaterialButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, label), MaterialIconButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) => createElement('button', { onClick: onPress, disabled }, label), MaterialMenu: ({ text, label, disabled, sections }: { text: string; label: string; disabled: boolean; sections: Array<{ actions: Array<{ id: string; label: string; selected?: boolean; onPress: () => void }> }> }) => createElement('details', { 'aria-label': label, 'data-disabled': disabled }, createElement('summary', null, text), ...sections.flatMap((section, index) => section.actions.map(action => createElement('button', { key: `${index}:${action.id}`, role: index === 0 ? 'menuitemradio' : 'button', 'aria-checked': action.selected, onClick: action.onPress }, action.label)))) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  ...Object.fromEntries(['Card', 'SectionTitle'].map(name => [name, ({ children }: { children: ReactNode }) => createElement('div', null, children)])),
  ListRow: ({ title, children, onPress }: { title: string; children: ReactNode; onPress?: () => void }) => createElement(onPress ? 'button' : 'div', { onClick: onPress }, title, children),
  Field: ({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) => createElement('textarea', { 'aria-label': 'Speech instructions', value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }),
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
vi.mock('../../api/client', () => ({ apiRequest: async () => ({ defaultModelId: 'first', data: [
  { id: 'first', name: 'First model', supportsInstructions: true, supportsSpeed: true, speedMin: 0.5, speedMax: 2, defaultVoice: 'coral', voices: [{ id: 'coral', label: 'Coral' }, { id: 'alloy', label: 'Alloy' }] },
  { id: 'second', name: 'Second model', defaultVoice: 'other', voices: [{ id: 'other', label: 'Other' }] },
] }) }))
vi.mock('./playback', async () => ({ speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeech: mocks.preview }))
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
  mocks.preview.mockImplementation(() => { if (speechPlayback.getSnapshot().key === 'preview:settings') speechPlayback.stop() })
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
  await act(async () => root.render(<QueryClientProvider client={client}><SpeechSettings /></QueryClientProvider>))
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
  expect([...container.querySelectorAll('summary')].some(summary => summary.textContent?.includes(text))).toBe(true)
}
async function startPreview() {
  await act(async () => { void speechPlayback.start('preview:settings', ['clip'], async () => ({ dispose() {}, play: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve())) })) })
}

it.each(['ios', 'android'])('persists %s model and voice choices, updates native selections, and restores them after hydration', async platform => {
  mocks.platform = platform
  await render()
  selected('Model', 'first', 'First model')
  expect(container.textContent).not.toContain('Use admin default')
  await choose('Model', 'first', 'First model')
  selected('Model', 'first', 'First model'); selected('Voice', 'coral', 'Coral')
  expect(persist).toHaveBeenCalledWith('speech', { modelId: 'first', models: {} })
  await click('Preview speech')
  expect(mocks.preview).toHaveBeenCalledWith(); expect(persist).toHaveBeenCalledTimes(1)
  expect(container.textContent).not.toContain('Preview Alloy')
  const preview = [...container.querySelectorAll('button')].find(button => button.textContent === 'Preview speech')!
  expect(container.querySelector('textarea')!.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

it.each(['ios', 'android'])('selects the actual admin default and persists explicit choices with %s native pickers', async platform => {
  mocks.platform = platform
  await render()
  selected('Model', 'first', 'First model'); selected('Voice', 'coral', 'Coral')
  expect(container.textContent).not.toContain('Use admin default')
  expect(container.textContent).not.toContain('Admin default: First model')
  expect(persist).not.toHaveBeenCalled()
  expect(usePreferencesStore.getState().speech).toEqual({ modelId: null, models: {} })
  await choose('Voice', 'alloy', 'Alloy')
  expect(usePreferencesStore.getState().speech).toEqual({ modelId: null, models: { first: { voice: 'alloy', instructions: '', speed: 1 } } })
  await startPreview(); await click('Use default voice')
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  selected('Voice', 'coral', 'Coral')
  expect(usePreferencesStore.getState().speech.models.first?.voice).toBeUndefined()
  await choose('Model', 'second', 'Second model')
  await startPreview(); await choose('Model', 'first', 'First model')
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  selected('Model', 'first', 'First model'); selected('Voice', 'coral', 'Coral')
  expect(persist).toHaveBeenLastCalledWith('speech', { modelId: 'first', models: { first: { voice: undefined, instructions: '', speed: 1 } } })
  await act(async () => {
    usePreferencesStore.setState({ speech: { modelId: 'second', models: {} } })
    await usePreferencesStore.getState().hydrate()
  })
  expect(usePreferencesStore.getState().speech.modelId).toBe('first')
  expect(usePreferencesStore.getState().speech.models.first?.voice).toBeUndefined()
  selected('Model', 'first', 'First model'); selected('Voice', 'coral', 'Coral')
})

it.each(['ios', 'android'])('persists %s inline instructions and bounded speed independently for each model', async platform => {
  mocks.platform = platform
  await render()
  const field = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Calm and clear')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Increase speech speed')
  expect(usePreferencesStore.getState().speech.models.first).toMatchObject({ instructions: 'Calm and clear', speed: 1.1 })
  for (let i = 0; i < 15; i++) await click('Increase speech speed')
  expect(usePreferencesStore.getState().speech.models.first?.speed).toBe(2)
  await choose('Model', 'second', 'Second model')
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.textContent).not.toContain('Increase speech speed')
  await choose('Model', 'first', 'First model')
  expect(container.querySelector('textarea')?.value).toBe('Calm and clear')
  for (let i = 0; i < 20; i++) await click('Decrease speech speed')
  expect(usePreferencesStore.getState().speech.models.first?.speed).toBe(0.5)
})

it('keeps newer native typing intact while React receives an earlier instructions value', async () => {
  mocks.platform = 'ios'
  await render()
  await act(async () => container.querySelector('textarea')!.focus())
  // Native typing is ahead of the preference update delivered to React.
  mocks.nativeText!.value = 'Calm and friendly'
  await act(async () => usePreferencesStore.setState({ speech: { modelId: null, models: { first: { instructions: 'Calm', speed: 1 } } } }))
  expect(mocks.nativeWrites).not.toHaveBeenCalled()
  expect(mocks.nativeText!.value).toBe('Calm and friendly')
  await act(async () => usePreferencesStore.setState({ speech: { modelId: null, models: { first: { instructions: 'Calm and friendly', speed: 1 } } } }))
  await act(async () => container.querySelector('textarea')!.blur())
  expect(mocks.nativeText!.value).toBe('Calm and friendly')
  // External changes still synchronize once the user finishes editing.
  await act(async () => usePreferencesStore.setState({ speech: { modelId: null, models: { first: { instructions: 'Clear', speed: 1 } } } }))
  expect(mocks.nativeWrites).toHaveBeenLastCalledWith('Clear')
})

it.each(['ios', 'android'])('disables %s unavailable previews and cancels after instruction and speed changes', async platform => {
  mocks.platform = platform
  usePreferencesStore.setState({ speech: { modelId: 'removed', models: {} } })
  await render()
  const preview = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Preview speech')!
  expect(preview().disabled).toBe(true)
  await choose('Model', 'first', 'First model')
  expect(preview().disabled).toBe(false)
  await startPreview()
  await act(async () => {
    const field = container.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'New instructions')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  await startPreview(); await click('Increase speech speed')
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  await act(async () => { await speechPlayback.start('preview:settings', ['text'], async () => { throw new Error('Speech generation failed') }) })
  expect(container.textContent).toContain('Speech generation failed')
  await click('Preview speech')
  expect(mocks.preview).toHaveBeenCalledOnce()
})
