// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdminProvidersPage } from './AdminProvidersPage'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mockProviders(providers: unknown[] = []) {
  mocks.api.mockImplementation(async (path: string) => ({ data: path === '/api/admin/providers' ? providers : [] }))
}

it('creates a provider with opt-in WebP conversion and rejects invalid quality', async () => {
  mockProviders()
  render(<AdminProvidersPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
  expect(screen.getByRole('switch', { name: 'Convert images to WebP' }).getAttribute('aria-checked')).toBe('false')
  expect(screen.queryByLabelText('WebP quality')).toBeNull()
  fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'Vision provider' } })
  fireEvent.change(screen.getByLabelText('Provider API key'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Convert images to WebP' }))
  const quality = screen.getByLabelText('WebP quality') as HTMLInputElement
  expect(quality.value).toBe('80')
  for (const value of ['', '0', '101', '75.5']) {
    fireEvent.change(quality, { target: { value } })
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
  }
  fireEvent.change(quality, { target: { value: '75' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/providers', { method: 'POST', body: expect.objectContaining({ convertImagesToWebp: true, webpQuality: 75 }) }))
})

it('loads saved quality and allows disabling conversion without replacing the API key', async () => {
  mockProviders([{
    id: 'provider-1', name: 'Vision provider', baseUrl: 'https://example.com/v1', hasApiKey: true,
    cacheAffinityMode: 'none', cacheAffinityScope: 'chat', cacheIsolationMode: 'none', cacheIsolationScope: 'user',
    toolResultImageMode: 'native', convertImagesToWebp: true, webpQuality: 85,
  }])
  render(<AdminProvidersPage />)
  fireEvent.click(await screen.findByTitle('Edit'))
  expect((screen.getByLabelText('WebP quality') as HTMLInputElement).value).toBe('85')
  fireEvent.click(screen.getByRole('switch', { name: 'Convert images to WebP' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/providers/provider-1', { method: 'PATCH', body: expect.objectContaining({ convertImagesToWebp: false, webpQuality: 85 }) }))
  const patch = mocks.api.mock.calls.find(([, options]) => options?.method === 'PATCH')![1].body
  expect(patch).not.toHaveProperty('apiKey')
})
