// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { META_MUSE_IMAGE_PRESET } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ platform: 'ios', set: vi.fn(), api: vi.fn(), preferences: { enabled: true, modelId: 'muse' as string | null } }))
vi.mock('react-native', () => ({ Platform: { get OS() { return mocks.platform } }, Text: ({ children }: { children: ReactNode }) => createElement('span', null, children) }))
vi.mock('@expo/ui/swift-ui', () => ({
  Section: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => createElement('div', null, children, footer),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Toggle: ({ label, isOn, onIsOnChange }: { label: string; isOn: boolean; onIsOnChange: (value: boolean) => void }) => createElement('button', { onClick: () => onIsOnChange(!isOn) }, label),
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: vi.fn(), foregroundStyle: vi.fn() }))
vi.mock('../../api/client', () => ({ apiRequest: mocks.api }))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: (selector: (state: unknown) => unknown) => selector({ imageGeneration: mocks.preferences }) }))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ instanceUrl: 'test', user: { id: 'user' } }) }))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({ usePrototypeStore: (selector: (state: unknown) => unknown) => selector({ setPreference: mocks.set }) }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  ...Object.fromEntries(['Card', 'SectionTitle', 'ListRow'].map(name => [name, ({ children }: { children: ReactNode }) => createElement('div', null, children)])),
}))
vi.mock('../../platform/MaterialUI', () => ({
  MaterialToggleRow: ({ title, value, onChange }: { title: string; value: boolean; onChange: (value: boolean) => void }) => createElement('button', { onClick: () => onChange(!value) }, title),
  MaterialButton: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
}))
vi.mock('../speech/SpeechPicker', () => ({ SpeechPicker: ({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: Array<{ id: string; label: string }>; onChange: (value: string) => void }) => createElement('select', { 'aria-label': label, value: value ?? '', onChange: (event: { target: { value: string } }) => onChange(event.target.value) }, createElement('option', { value: '' }, placeholder), options.map(option => createElement('option', { key: option.id, value: option.id }, option.label))) }))
import { ImageGenerationSettings } from './ImageGenerationSettings'
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ImageGenerationSettings /></QueryClientProvider>)
afterEach(() => { cleanup(); vi.clearAllMocks() })
it.each(['ios', 'android'])('shows token pricing and persists model selection and opt-in on %s', async platform => {
  mocks.platform = platform; mocks.preferences = { enabled: false, modelId: null }
  mocks.api.mockResolvedValue({ data: [{ ...META_MUSE_IMAGE_PRESET, id: 'muse', billUsers: true, billingUnit: 'tokens', tokenPrices: { input: 2000000, cachedInput: 500000, output: 10000000 } }] })
  const view = mount()
  await screen.findByRole('option', { name: 'Muse Image' })
  fireEvent.change(screen.getByLabelText('Image model'), { target: { value: 'muse' } })
  expect(mocks.set).toHaveBeenCalledWith('imageGeneration', { enabled: false, modelId: 'muse' })
  view.unmount(); mocks.preferences = { enabled: false, modelId: 'muse' }; mount()
  expect(await screen.findByText('$2 / 1M Input tokens · $0.5 / 1M Cached input tokens · $10 / 1M Output tokens')).toBeTruthy()
  fireEvent.click(screen.getByText('Enable image generation'))
  expect(mocks.set).toHaveBeenCalledWith('imageGeneration', { enabled: true, modelId: 'muse' })
})
it.each(['ios', 'android'])('retains unavailable selections and permits opt-out on %s', async platform => {
  mocks.platform = platform; mocks.preferences = { enabled: true, modelId: 'retired' }
  mocks.api.mockResolvedValue({ data: [{ ...META_MUSE_IMAGE_PRESET, id: 'muse' }], defaultModelId: 'muse' }); mount()
  await screen.findByText('Your selected image model is unavailable. Choose another model to generate images.')
  expect(mocks.set).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Enable image generation'))
  expect(mocks.set).toHaveBeenCalledWith('imageGeneration', { enabled: false, modelId: 'retired' })
})

it.each(['ios', 'android'])('uses the admin default without persisting a selection or opting in on %s', async platform => {
  mocks.platform = platform; mocks.preferences = { enabled: false, modelId: null }
  mocks.api.mockResolvedValue({ data: [{ ...META_MUSE_IMAGE_PRESET, id: 'muse', enabled: true }], defaultModelId: 'muse' })
  mount()
  await screen.findByText('Free to use')
  expect((screen.getByLabelText('Image model') as HTMLSelectElement).value).toBe('muse')
  expect(mocks.set).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Enable image generation'))
  expect(mocks.set).toHaveBeenCalledWith('imageGeneration', { enabled: true, modelId: null })
})
it.each(['ios', 'android'])('preserves explicit choices over the admin default on %s', async platform => {
  mocks.platform = platform; mocks.preferences = { enabled: false, modelId: 'chosen' }
  mocks.api.mockResolvedValue({ data: [{ ...META_MUSE_IMAGE_PRESET, id: 'muse' }, { ...META_MUSE_IMAGE_PRESET, id: 'chosen', name: 'My model' }], defaultModelId: 'muse' })
  mount()
  await screen.findByText('Free to use')
  expect((screen.getByLabelText('Image model') as HTMLSelectElement).value).toBe('chosen')
  expect(mocks.set).not.toHaveBeenCalled()
})
