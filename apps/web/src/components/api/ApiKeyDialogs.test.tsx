// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiKeyModelsDialog } from './ApiKeyDialogs'
import { useApiKeys } from '@/stores/apiKeys'
import { apiRequest } from '@/lib/api'
import type { ApiKey } from '@/lib/types'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }))
const apiKey: ApiKey = {
  id: 'key-1', name: 'Laptop', prefix: 'sk-pulpo-test', createdAt: 1, lastUsedAt: null,
  scopes: ['responses', 'models'], allowedModels: [], monthlyBudget: 10, totalBudget: null, disabled: true,
  spentThisMonth: 1, spentTotal: 2,
}
const onClose = vi.fn()
const clipboard = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiRequest).mockReset()
  useApiKeys.setState({ keys: [apiKey] })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard.mockResolvedValue(undefined) } })
})
afterEach(cleanup)

it('shows friendly names and copyable API IDs, searches both, and explains disabled keys', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: 'model-uuid-1', name: 'Friendly One' }, { id: 'model-uuid-2', name: 'Friendly Two' }] })
  render(<ApiKeyModelsDialog apiKey={apiKey} onClose={onClose} />)
  expect(screen.getByText('Loading models…')).toBeTruthy()
  expect(await screen.findByText('Friendly One')).toBeTruthy()
  expect(screen.getByText('model-uuid-1')).toBeTruthy()
  expect(screen.getByText('This key is disabled. Enable it to use these models.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Copy API ID for Friendly One' }))
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith('model-uuid-1'))
  const search = screen.getByRole('textbox', { name: 'Search models by name or API ID' })
  fireEvent.change(search, { target: { value: 'UUID-2' } })
  expect(screen.queryByText('Friendly One')).toBeNull()
  expect(screen.getByText('Friendly Two')).toBeTruthy()
  fireEvent.change(search, { target: { value: 'Friendly One' } })
  expect(screen.getByText('Friendly One')).toBeTruthy()
  fireEvent.change(search, { target: { value: 'missing' } })
  expect(screen.getByText('No models match your search.')).toBeTruthy()
})

it('retries failed model loads and distinguishes empty permissions from loading failures', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: [] })
  render(<ApiKeyModelsDialog apiKey={{ ...apiKey, disabled: false, scopes: ['models'] }} onClose={onClose} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('No models are currently available to this key.')).toBeNull()
  expect(screen.getByText('This key can list models but does not have inference access.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('No models are currently available to this key.')).toBeTruthy()
})

it('does not show a previous key’s models when its request finishes late', async () => {
  let resolveFirst!: (value: unknown) => void
  vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce({ data: [{ id: 'new', name: 'New model' }] })
  const view = render(<ApiKeyModelsDialog apiKey={apiKey} onClose={onClose} />)
  view.rerender(<ApiKeyModelsDialog apiKey={{ ...apiKey, id: 'key-2' }} onClose={onClose} />)
  expect(await screen.findByText('New model')).toBeTruthy()
  await act(async () => resolveFirst({ data: [{ id: 'old', name: 'Old model' }] }))
  expect(screen.queryByText('Old model')).toBeNull()
  expect(screen.getByText('New model')).toBeTruthy()
})
