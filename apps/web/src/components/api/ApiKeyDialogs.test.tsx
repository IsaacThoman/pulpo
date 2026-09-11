// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiKeyModelsDialog, RenameApiKeyDialog } from './ApiKeyDialogs'
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

it('renames a key on submit and preserves its other settings', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ id: apiKey.id, name: 'Work scripts' })
  render(<RenameApiKeyDialog apiKey={apiKey} onClose={onClose} />)
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Work scripts  ' } })
  fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(apiRequest).toHaveBeenCalledWith('/api/api-keys/key-1', { method: 'PATCH', body: { name: 'Work scripts' } })
  expect(useApiKeys.getState().keys).toEqual([{ ...apiKey, name: 'Work scripts' }])
})

it('validates empty names and retains the original name on failure so saving can be retried', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: apiKey.id, name: 'Work' })
  render(<RenameApiKeyDialog apiKey={apiKey} onClose={onClose} />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(useApiKeys.getState().keys).toEqual([apiKey])
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('does not save a cancelled rename', () => {
  render(<RenameApiKeyDialog apiKey={apiKey} onClose={onClose} />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(apiRequest).not.toHaveBeenCalled()
})

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
