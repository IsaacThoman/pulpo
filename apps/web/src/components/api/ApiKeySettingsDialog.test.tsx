// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiKeySettingsDialog } from './ApiKeySettingsDialog'
import { useApiKeys } from '@/stores/apiKeys'
import { useCatalog } from '@/stores/catalog'
import { apiRequest } from '@/lib/api'
import type { ApiKey, Model } from '@/lib/types'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }))
const apiKey: ApiKey = {
  id: 'key-1', name: 'Laptop', prefix: 'sk-pulpo-test', createdAt: 1, lastUsedAt: null,
  scopes: ['responses', 'models'], allowedModels: ['model-1'], monthlyBudget: 10, totalBudget: 50,
  spentThisMonth: 1, spentTotal: 2, disabled: true,
}
const model = (id: string, name: string): Model => ({
  id, name, providerGroupId: 'internal', provider: 'Pulpo', inferenceProvider: 'Pulpo',
  enabled: true, agentEnabled: false, contextWindow: 0, description: '', tags: [], presets: [],
  labLogo: 'pulpo', modelLogo: 'pulpo', iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0, perMessagePrice: 0,
})
const onClose = vi.fn()
const onCreated = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiRequest).mockReset().mockResolvedValue({})
  useApiKeys.setState({ keys: [apiKey] })
  useCatalog.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
  useCatalog.setState({ models: [model('model-1', 'Friendly One'), model('model-2', 'Friendly Two'), model('codex:test', 'Codex model')] })
})
afterEach(cleanup)
const edit = (key = apiKey) => render(<ApiKeySettingsDialog apiKey={key} onClose={onClose} onCreated={onCreated} />)

it('prefills and saves every setting while preserving secret identity, enabled state and accumulated spending', async () => {
  edit()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Laptop')
  expect((screen.getByLabelText('Monthly limit') as HTMLInputElement).value).toBe('10')
  expect((screen.getByLabelText('All-time limit') as HTMLInputElement).value).toBe('50')
  expect(screen.getByRole('checkbox', { name: 'Friendly One' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('checkbox', { name: 'All models' }).getAttribute('aria-checked')).toBe('false')
  expect(screen.queryByText('Codex model')).toBeNull()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Work  ' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'List models' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Friendly One' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Friendly Two' }))
  fireEvent.change(screen.getByLabelText('Monthly limit'), { target: { value: '12.34' } })
  fireEvent.change(screen.getByLabelText('All-time limit'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(apiRequest).toHaveBeenCalledWith('/api/api-keys/key-1', { method: 'PATCH', body: {
    name: 'Work', scopes: ['responses'], allowedModels: ['model-2'], monthlyBudgetMicros: 12_340_000, lifetimeBudgetMicros: null,
  } })
  expect(useApiKeys.getState().keys).toEqual([{ ...apiKey, name: 'Work', scopes: ['responses'], allowedModels: ['model-2'], monthlyBudget: 12.34, totalBudget: null }])
  expect(onCreated).not.toHaveBeenCalled()
})

it('can restore all-model access and remove both spending limits', async () => {
  edit()
  fireEvent.click(screen.getByRole('checkbox', { name: 'All models' }))
  fireEvent.change(screen.getByLabelText('Monthly limit'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('All-time limit'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(apiRequest).toHaveBeenCalledWith('/api/api-keys/key-1', expect.objectContaining({ body: expect.objectContaining({ allowedModels: [], monthlyBudgetMicros: null, lifetimeBudgetMicros: null }) }))
})

it('validates names, scopes, selected models and spending limits', () => {
  edit()
  const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
  expect(save().disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Inference' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'List models' }))
  expect(save().disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Inference' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Friendly One' }))
  expect(save().disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: 'All models' }))
  for (const value of ['0', '-5', '0.0000001']) {
    fireEvent.change(screen.getByLabelText('Monthly limit'), { target: { value } })
    expect(save().disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('positive spending limit')
  }
  fireEvent.change(screen.getByLabelText('Monthly limit'), { target: { value: '' } })
  expect(save().disabled).toBe(false)
  expect(apiRequest).not.toHaveBeenCalled()
})

it('retains unavailable model restrictions and lets the user explicitly remove them', async () => {
  edit({ ...apiKey, allowedModels: ['unavailable-id'] })
  expect(screen.getByText('unavailable-id')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(apiRequest).toHaveBeenCalledWith('/api/api-keys/key-1', expect.objectContaining({ body: expect.objectContaining({ allowedModels: ['unavailable-id'] }) }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable-id' }))
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
})

it('keeps edits for retry after a failure and does not modify the saved settings on cancel', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({})
  edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(useApiKeys.getState().keys).toEqual([apiKey])
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  cleanup()
  edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Discarded' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(apiRequest).toHaveBeenCalledTimes(2)
})

it('uses the same form to create a key and reveals its secret only on creation', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'new-key', secret: 'new-secret' }).mockResolvedValueOnce({ data: [] })
  render(<ApiKeySettingsDialog onClose={onClose} onCreated={onCreated} />)
  expect(screen.getByRole('heading', { name: 'Create API key' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'All models' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-secret'))
  expect(apiRequest).toHaveBeenCalledWith('/api/api-keys', { method: 'POST', body: {
    name: 'New key', scopes: ['responses', 'models'], allowedModels: [], monthlyBudgetMicros: null, lifetimeBudgetMicros: null,
  } })
})
