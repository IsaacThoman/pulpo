// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CUSTOM_INSTRUCTIONS_MAX_LENGTH, type InstructionPreset } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  platform: 'android', nativeWrites: vi.fn(), nativeText: null as null | { value: string }, saved: new Map<string, unknown>(),
  settings: vi.fn(), maxLength: undefined as number | undefined,
}))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } }, Appearance: { setColorScheme: vi.fn() },
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}))
vi.mock('@expo/ui/swift-ui', () => {
  const Container = ({ children, title, footer }: { children: ReactNode; title?: string; footer?: ReactNode }) => createElement('section', { 'aria-label': title }, title, children, footer)
  return {
    Section: Container,
    Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
    useNativeState: (value: string) => useRef({ value, get() { return this.value }, set(next: string) { mocks.nativeWrites(next); this.value = next } }).current,
    TextField: ({ text, onTextChange, onFocusChange, maxLength }: { text: { value: string; get: () => string }; onTextChange: (text: string) => void; onFocusChange: (focused: boolean) => void; maxLength: number }) => {
      mocks.nativeText = text
      mocks.maxLength = maxLength
      return createElement('textarea', { 'aria-label': 'Custom instructions', value: text.get(), onFocus: () => onFocusChange(true), onBlur: () => onFocusChange(false), onChange: (event: { target: { value: string } }) => { text.value = event.target.value; onTextChange(event.target.value) } })
    },
    Toggle: ({ label, isOn, onIsOnChange }: { label: string; isOn: boolean; onIsOnChange: (value: boolean) => void }) => createElement('button', { role: 'switch', 'aria-checked': isOn, onClick: () => onIsOnChange(!isOn) }, label),
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  }
})
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(['accessibilityLabel', 'foregroundStyle', 'lineLimit', 'textFieldStyle', 'tint'].map(name => [name, () => ({})])))
vi.mock('../../platform/MaterialUI', () => ({
  MaterialButton: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  MaterialToggleRow: ({ title, value, onChange }: { title: string; value: boolean; onChange: (value: boolean) => void }) => createElement('button', { role: 'switch', 'aria-checked': value, onClick: () => onChange(!value) }, title),
}))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  ...Object.fromEntries(['Card', 'SectionTitle'].map(name => [name, ({ children }: { children: ReactNode }) => createElement('div', null, children)])),
  Field: ({ value, onChangeText, maxLength }: { value: string; onChangeText: (text: string) => void; maxLength: number }) => {
    mocks.maxLength = maxLength
    return createElement('textarea', { 'aria-label': 'Custom instructions', value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) })
  },
}))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({}) }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }))
vi.mock('../../data/database', () => ({
  getValue: async (namespace: string, key: string) => mocks.saved.get(`${namespace}:${key}`),
  setValue: async (namespace: string, key: string, value: unknown) => { mocks.saved.set(`${namespace}:${key}`, value) },
}))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' }, instanceUrl: 'test' }) }))
vi.mock('../../api/client', () => ({ apiRequest: (path: string) => mocks.settings(path) }))
import { CustomInstructionsSettings } from './CustomInstructionsSettings'
import { usePreferencesStore } from '../../store/preferences'
import { defaultPreferences } from '../../store/preferenceMapping'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { createInitialState } from '../../mockup5/src/initialState'
import { configureProductionActions } from '../../mockup5/src/production/productionActions'

const presets: InstructionPreset[] = [
  { id: 'casual', title: 'Casual', instructions: 'Be casual.', color: '#f7b75f', defaultEnabled: false },
  { id: 'concise', title: 'Concise', instructions: 'Be brief.', color: '#2563eb', defaultEnabled: true },
]

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement, root: Root, client: QueryClient
const persist = vi.fn((key: keyof typeof defaultPreferences, value: (typeof defaultPreferences)[keyof typeof defaultPreferences]) => usePreferencesStore.getState().setPreference(key, value))
beforeEach(() => {
  mocks.saved.clear()
  mocks.settings.mockResolvedValue({ values: {}, instructionPresets: presets })
  usePreferencesStore.setState({ ...defaultPreferences, pendingServerPreferenceKeys: [] })
  usePrototypeStore.setState(createInitialState())
  configureProductionActions({ setPreference: persist })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear(); container.remove(); vi.clearAllMocks()
})
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><CustomInstructionsSettings /></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
async function type(text: string) {
  const field = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const toggle = (title: string) => [...container.querySelectorAll('[role=switch]')].find(element => element.textContent === title) as HTMLButtonElement | undefined

it.each(['ios', 'android'])('saves %s custom instructions to the account with the shared length limit', async platform => {
  mocks.platform = platform
  usePreferencesStore.setState({ customInstructions: 'Prefer code.' })
  await render()
  expect(container.querySelector('textarea')!.value).toBe('Prefer code.')
  expect(mocks.maxLength).toBe(CUSTOM_INSTRUCTIONS_MAX_LENGTH)
  expect(container.textContent).toContain('Appended to every conversation as a system prompt.')
  await type('Prefer code. Never apologize.')
  expect(persist).toHaveBeenLastCalledWith('customInstructions', 'Prefer code. Never apologize.')
  expect(usePreferencesStore.getState()).toMatchObject({ customInstructions: 'Prefer code. Never apologize.', pendingServerPreferenceKeys: ['customInstructions'] })
})

it.each(['ios', 'android'])('toggles %s presets from admin defaults and records explicit choices', async platform => {
  mocks.platform = platform
  await render()
  expect(mocks.settings).toHaveBeenCalledWith('/api/settings')
  expect(toggle('Casual')!.getAttribute('aria-checked')).toBe('false')
  expect(toggle('Concise')!.getAttribute('aria-checked')).toBe('true')
  await act(async () => toggle('Casual')!.click())
  expect(usePreferencesStore.getState().instructionPresetSelections).toEqual({ casual: true })
  await act(async () => toggle('Concise')!.click())
  expect(persist).toHaveBeenLastCalledWith('instructionPresetSelections', { casual: true, concise: false })
  expect(toggle('Casual')!.getAttribute('aria-checked')).toBe('true')
  expect(toggle('Concise')!.getAttribute('aria-checked')).toBe('false')
})

it.each(['ios', 'android'])('hides %s presets when the instance has none and offers a retry when they fail to load', async platform => {
  mocks.platform = platform
  mocks.settings.mockResolvedValueOnce({ values: {} })
  await render()
  expect(container.textContent).not.toContain('Instruction presets')
  await act(async () => root.unmount())
  root = createRoot(container); client.clear()
  mocks.settings.mockRejectedValueOnce(new Error('offline'))
  await render()
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Instruction presets could not be loaded. Tap to retry.')
  expect(retry).toBeDefined()
  await act(async () => retry!.click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(toggle('Casual')).toBeDefined()
})

it('keeps newer native typing intact while React receives an earlier instructions value', async () => {
  mocks.platform = 'ios'
  await render()
  await act(async () => container.querySelector('textarea')!.focus())
  mocks.nativeText!.value = 'Be terse.'
  await act(async () => usePreferencesStore.setState({ customInstructions: 'Be' }))
  expect(mocks.nativeWrites).not.toHaveBeenCalled()
  expect(mocks.nativeText!.value).toBe('Be terse.')
  await act(async () => usePreferencesStore.setState({ customInstructions: 'Be terse.' }))
  await act(async () => container.querySelector('textarea')!.blur())
  expect(mocks.nativeWrites).not.toHaveBeenCalled()
  // Changes from another device still arrive once editing ends.
  await act(async () => usePreferencesStore.setState({ customInstructions: 'Edited on web' }))
  expect(mocks.nativeWrites).toHaveBeenLastCalledWith('Edited on web')
})
