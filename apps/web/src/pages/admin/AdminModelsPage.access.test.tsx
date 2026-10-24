// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createModelSchema } from '@pulpo/contracts'
import { AdminModelsPage } from './AdminModelsPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

const userRow = (id: string, name: string, role = 'user') => ({
  user: { id, name, username: name.toLowerCase(), email: `${name.toLowerCase()}@example.test`, role, avatarUrl: null },
})

function mockModels(extra: Record<string, unknown> = {}) {
  const model = { ...createModelSchema.parse({
    id: 'opus', name: 'Opus', upstreamModelId: 'anthropic/claude-opus',
    providerConnectionId: '11111111-1111-4111-8111-111111111111',
    labId: '22222222-2222-4222-8222-222222222222',
    contextWindow: 200000, maxOutputTokens: 16000,
    inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
  }), presets: [], ...extra }
  mocks.api.mockImplementation(async (path: string) => ({ values: {}, data:
    path === '/api/admin/models' ? [model]
      : path === '/api/admin/providers' ? [{ id: model.providerConnectionId, name: 'OpenRouter' }]
        : path === '/api/admin/labs' ? [{ id: model.labId, name: 'Anthropic', customIconId: null }]
          : path === '/api/admin/users' ? [userRow('admin-1', 'Root', 'admin'), userRow('user-1', 'Ada'), userRow('user-2', 'Grace')] : [],
  }))
}

it('restricts a model to selected users from the model editor', async () => {
  mockModels()
  render(<AdminModelsPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  expect(screen.queryByText('Allowed users')).toBeNull()
  expect(mocks.api).not.toHaveBeenCalledWith('/api/admin/users')
  fireEvent.click(screen.getByRole('switch', { name: /Restrict access/ }))
  expect(await screen.findByText('No users selected. Only admins can use this model.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Add users' }))
  const search = await screen.findByRole('textbox', { name: 'Search users' })
  // Admins always have access and are not offered.
  await waitFor(() => expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
    expect.stringContaining('Ada'), expect.stringContaining('Grace'),
  ]))
  fireEvent.change(search, { target: { value: 'grace@' } })
  const grace = screen.getByRole('menuitemcheckbox')
  fireEvent.click(grace)
  expect(grace.getAttribute('aria-checked')).toBe('true')
  fireEvent.keyDown(search, { key: 'Escape' })

  const list = await screen.findByRole('list')
  expect(within(list).getByText('Grace')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/opus', {
    method: 'PATCH',
    body: expect.objectContaining({ restricted: true, allowedUserIds: ['user-2'] }),
  }))
})

it('shows restricted models in the list and removes granted users', async () => {
  mockModels({ restricted: true, allowedUserIds: ['user-1', 'user-2'] })
  render(<AdminModelsPage />)
  const badge = await screen.findByText(/Restricted · 2 users/)
  await waitFor(() => expect(badge.getAttribute('title')).toBe('Ada, Grace'))
  fireEvent.click(screen.getByTitle('Edit'))
  fireEvent.click(await screen.findByTitle('Remove Ada'))
  expect(screen.queryByTitle('Remove Ada')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save & update' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/models/opus', {
    method: 'PATCH',
    body: expect.objectContaining({ restricted: true, allowedUserIds: ['user-2'] }),
  }))
})
