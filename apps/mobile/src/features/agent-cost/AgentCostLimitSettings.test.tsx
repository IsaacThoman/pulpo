// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement, useRef, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({
  platform: 'ios',
  preferences: { agentCostLimitEnabled: true, agentCostLimitMicros: 1_000_000 },
  setPreference: vi.fn(),
  submit: undefined as undefined | (() => void),
}))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}))
vi.mock('@expo/ui/swift-ui', () => ({
  Section: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => createElement('section', { 'aria-label': title }, children, footer),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Toggle: ({ label, isOn, onIsOnChange }: { label: string; isOn: boolean; onIsOnChange: (value: boolean) => void }) => createElement('input', { type: 'checkbox', 'aria-label': label, checked: isOn, onChange: () => onIsOnChange(!isOn) }),
  TextField: ({ text, onTextChange, onFocusChange }: { text: { get: () => string }; onTextChange: (value: string) => void; onFocusChange: (focused: boolean) => void }) => createElement('input', {
    'aria-label': 'Cost threshold in US dollars', defaultValue: text.get(), onChange: (event: { target: { value: string } }) => onTextChange(event.target.value), onBlur: () => onFocusChange(false),
  }),
  HStack: passthrough, Spacer: () => null,
  useNativeState: (initial: string) => {
    const value = useRef(initial)
    return { get: () => value.current, set: (next: string) => { value.current = next } }
  },
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({
  ...Object.fromEntries(['accessibilityLabel', 'foregroundStyle', 'frame', 'keyboardType', 'monospacedDigit', 'multilineTextAlignment', 'submitLabel', 'textFieldStyle', 'tint'].map(name => [name, vi.fn()])),
  onSubmit: (handler: () => void) => { mocks.submit = handler },
}))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({
  usePrototypeStore: (selector: (state: unknown) => unknown) => selector({ preferences: mocks.preferences, setPreference: mocks.setPreference }),
}))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ green: 'green', secondary: 'gray' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Card: passthrough,
  SectionTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
}))
vi.mock('../../platform/MaterialUI', () => ({
  MaterialToggleRow: ({ title, detail, value, onChange }: { title: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) => createElement('label', null,
    createElement('input', { type: 'checkbox', 'aria-label': title, checked: value, onChange: () => onChange(!value) }), detail),
  MaterialField: ({ label, value, onChangeText, onSubmitEditing }: { label: string; value: string; onChangeText: (value: string) => void; onSubmitEditing: () => void }) => createElement('input', {
    'aria-label': label, value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value), onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') onSubmitEditing() },
  }),
}))
import { AgentCostLimitSettings } from './AgentCostLimitSettings'
import { costLimitDollars } from './costLimitDraft'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.preferences = { agentCostLimitEnabled: true, agentCostLimitMicros: 1_000_000 }
})

const HELP = 'Pause for confirmation after an agent loop exceeds set cost threshold. Does not guarantee total cost remains below threshold.'

it('shows the threshold in dollars like the web input', () => {
  expect(costLimitDollars(1_000_000)).toBe('1')
  expect(costLimitDollars(2_500_000)).toBe('2.5')
  expect(costLimitDollars(10_000)).toBe('0.01')
})

it('saves a typed iOS threshold in whole-cent micros when editing ends', () => {
  mocks.platform = 'ios'
  render(<AgentCostLimitSettings />)
  expect(screen.getByText(HELP)).toBeTruthy()
  const field = screen.getByLabelText('Cost threshold in US dollars')
  fireEvent.change(field, { target: { value: '$2.555' } })
  expect(mocks.setPreference).not.toHaveBeenCalled()
  mocks.submit?.()
  expect(mocks.setPreference).toHaveBeenCalledWith('agentCostLimitMicros', 2_560_000)
})

it('restores the saved iOS threshold when the typed amount is not a number', () => {
  mocks.platform = 'ios'
  render(<AgentCostLimitSettings />)
  const field = screen.getByLabelText('Cost threshold in US dollars')
  fireEvent.change(field, { target: { value: 'lots' } })
  fireEvent.blur(field)
  expect(mocks.setPreference).not.toHaveBeenCalled()
})

it('saves an unfinished edit when the screen closes', () => {
  mocks.platform = 'ios'
  const view = render(<AgentCostLimitSettings />)
  fireEvent.change(screen.getByLabelText('Cost threshold in US dollars'), { target: { value: '7' } })
  view.unmount()
  expect(mocks.setPreference).toHaveBeenCalledWith('agentCostLimitMicros', 7_000_000)
})

it.each(['ios', 'android'])('turns the warning off and hides the threshold on %s', platform => {
  mocks.platform = platform
  const view = render(<AgentCostLimitSettings />)
  fireEvent.click(screen.getByLabelText('Enable cost warning threshold'))
  expect(mocks.setPreference).toHaveBeenCalledWith('agentCostLimitEnabled', false)
  mocks.preferences = { agentCostLimitEnabled: false, agentCostLimitMicros: 1_000_000 }
  view.rerender(<AgentCostLimitSettings />)
  expect(screen.queryByLabelText(/Cost threshold/)).toBeNull()
})

it('clamps an Android threshold to the supported range on submit', () => {
  mocks.platform = 'android'
  render(<AgentCostLimitSettings />)
  expect(screen.getByText(HELP)).toBeTruthy()
  const field = screen.getByLabelText('Cost threshold (US dollars)') as HTMLInputElement
  fireEvent.change(field, { target: { value: '0' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(mocks.setPreference).toHaveBeenCalledWith('agentCostLimitMicros', 10_000)
  expect(field.value).toBe('0.01')
})
