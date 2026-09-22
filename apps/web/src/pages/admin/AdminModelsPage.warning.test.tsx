// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createModelSchema } from '@pulpo/contracts'
import { AdminModelsPage } from './AdminModelsPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mockModels(warningMessage = '') {
  const model = { ...createModelSchema.parse({
    id: 'opus', name: 'Opus', upstreamModelId: 'anthropic/claude-opus',
    providerConnectionId: '11111111-1111-4111-8111-111111111111',
    labId: '22222222-2222-4222-8222-222222222222',
    contextWindow: 200000, maxOutputTokens: 16000, warningMessage,
    inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
  }), presets: [] }
  mocks.api.mockImplementation(async (path: string) => ({ data:
    path === '/api/admin/models' ? [model]
      : path === '/api/admin/providers' ? [{ id: model.providerConnectionId, name: 'OpenRouter' }]
        : path === '/api/admin/labs' ? [{ id: model.labId, name: 'Anthropic', customIconId: null }] : [],
  }))
}

it('edits, previews, and saves a markdown composer warning with its dismissal period', async () => {
  mockModels()
  render(<AdminModelsPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  expect(screen.queryByRole('spinbutton', { name: 'Hide after dismissal (days)' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Composer warning'), {
    target: { value: 'Opus uses limits faster. [Pricing](https://example.com/pricing)' },
  })
  expect(screen.getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe('https://example.com/pricing')
  const days = screen.getByRole('spinbutton', { name: 'Hide after dismissal (days)' }) as HTMLInputElement
  expect(days.value).toBe('30')
  fireEvent.change(days, { target: { value: '7' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/opus', {
    method: 'PATCH',
    body: expect.objectContaining({
      warningMessage: 'Opus uses limits faster. [Pricing](https://example.com/pricing)',
      warningDismissDays: 7,
    }),
  }))
})
