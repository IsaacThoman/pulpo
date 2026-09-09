// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { META_MUSE_IMAGE_PRESET } from '@pulpo/contracts'
import { ImageGenerationSettings } from './ImageGenerationSettings'
import { useSettings } from '@/stores/settings'
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) }, configurable: true })
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true }) })
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' } }) }))
Element.prototype.scrollIntoView = vi.fn()
afterEach(() => { cleanup(); vi.clearAllMocks() })
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ImageGenerationSettings /></QueryClientProvider>)
it('requires a model selection before opt-in and shows its price', async () => {
  mocks.api.mockResolvedValue({ data: [{ ...META_MUSE_IMAGE_PRESET, id: 'muse', enabled: true, billUsers: true, imagePriceMicros: 10000 }] })
  useSettings.setState({ imageGeneration: { enabled: false, modelId: null } })
  mount()
  expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('combobox', { name: 'Image model' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Muse Image' }))
  expect(useSettings.getState().imageGeneration).toEqual({ enabled: false, modelId: 'muse' })
  expect(await screen.findByText('$0.01 / image')).toBeTruthy()
  fireEvent.click(screen.getByRole('switch'))
  expect(useSettings.getState().imageGeneration).toEqual({ enabled: true, modelId: 'muse' })
})
it('preserves unavailable selections and allows disabling them', async () => {
  mocks.api.mockResolvedValue({ data: [] })
  useSettings.setState({ imageGeneration: { enabled: true, modelId: 'retired' } })
  mount()
  expect(await screen.findByText('Your selected image model is unavailable. Choose another model to generate images.')).toBeTruthy()
  expect(screen.getByText('Selected model unavailable')).toBeTruthy()
  expect(useSettings.getState().imageGeneration.modelId).toBe('retired')
  fireEvent.click(screen.getByRole('switch'))
  expect(useSettings.getState().imageGeneration).toEqual({ enabled: false, modelId: 'retired' })
})
it('shows catalog failures and provides retry', async () => {
  mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] })
  useSettings.setState({ imageGeneration: { enabled: false, modelId: null } })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByText('An admin must configure an image model first.')).toBeTruthy())
})
