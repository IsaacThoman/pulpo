// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createModelSchema } from '@pulpo/contracts'
import { AdminModelsPage } from './AdminModelsPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mockModels(promptCaching: 'auto' | 'enabled' | 'disabled') {
  const model = { ...createModelSchema.parse({
    id: 'claude', name: 'Claude', upstreamModelId: 'anthropic/claude-sonnet-4.6',
    providerConnectionId: '11111111-1111-4111-8111-111111111111',
    labId: '22222222-2222-4222-8222-222222222222',
    contextWindow: 200000, maxOutputTokens: 16000, promptCaching,
    inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
  }), presets: [] }
  mocks.api.mockImplementation(async (path: string) => ({ data:
    path === '/api/admin/models' ? [model]
      : path === '/api/admin/providers' ? [{ id: model.providerConnectionId, name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }]
        : path === '/api/admin/labs' ? [{ id: model.labId, name: 'Anthropic', customIconId: null }] : [],
  }))
}

it.each(['auto', 'enabled', 'disabled'] as const)('loads and saves model prompt caching mode %s', async (mode) => {
  mockModels(mode)
  render(<AdminModelsPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  const select = screen.getByRole('combobox', { name: 'Prompt caching' })
  expect(select.textContent).toBe(mode[0]!.toUpperCase() + mode.slice(1))
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/claude', {
    method: 'PATCH', body: expect.objectContaining({ promptCaching: mode }),
  }))
})

it('lets the admin change automatic caching to disabled', async () => {
  mockModels('auto')
  HTMLElement.prototype.scrollIntoView = vi.fn()
  render(<AdminModelsPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Prompt caching' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: 'Disabled' }))
  expect(screen.getByText(/It cannot turn off caching performed automatically/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/claude', {
    method: 'PATCH', body: expect.objectContaining({ promptCaching: 'disabled' }),
  }))
})

it('defaults a new model to automatic caching', async () => {
  mockModels('disabled')
  render(<AdminModelsPage />)
  const create = screen.getByRole('button', { name: 'New model' })
  await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(create)
  expect(screen.getByRole('combobox', { name: 'Prompt caching' }).textContent).toBe('Auto')
})
