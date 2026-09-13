// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createModelSchema } from '@pulpo/contracts'
import { AdminModelsPage } from './AdminModelsPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mockModels(promptCachingEnabled: boolean) {
  const model = { ...createModelSchema.parse({
    id: 'claude', name: 'Claude', upstreamModelId: 'anthropic/claude-sonnet-4.6',
    providerConnectionId: '11111111-1111-4111-8111-111111111111',
    labId: '22222222-2222-4222-8222-222222222222',
    contextWindow: 200000, maxOutputTokens: 16000, promptCachingEnabled,
    inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
  }), presets: [] }
  mocks.api.mockImplementation(async (path: string) => ({ data:
    path === '/api/admin/models' ? [model]
      : path === '/api/admin/providers' ? [{ id: model.providerConnectionId, name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }]
        : path === '/api/admin/labs' ? [{ id: model.labId, name: 'Anthropic', customIconId: null }] : [],
  }))
}

it.each([true, false])('loads and saves explicit prompt caching set to %s', async (enabled) => {
  mockModels(enabled)
  render(<AdminModelsPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  expect(screen.getByRole('switch', { name: /^Explicit prompt caching/ }).getAttribute('aria-checked')).toBe(String(enabled))
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/claude', {
    method: 'PATCH', body: expect.objectContaining({ promptCachingEnabled: enabled }),
  }))
})

it('lets the admin opt a model into explicit caching', async () => {
  mockModels(false)
  render(<AdminModelsPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  fireEvent.click(screen.getByRole('switch', { name: /^Explicit prompt caching/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/claude', {
    method: 'PATCH', body: expect.objectContaining({ promptCachingEnabled: true }),
  }))
})

it('defaults a new model to disabled caching', async () => {
  mockModels(true)
  render(<AdminModelsPage />)
  const create = screen.getByRole('button', { name: 'New model' })
  await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(create)
  expect(screen.getByRole('switch', { name: /^Explicit prompt caching/ }).getAttribute('aria-checked')).toBe('false')
})
