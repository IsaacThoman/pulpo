// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdminImageModelsPage } from './AdminImageModelsPage'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('creates an OpenAI preset with an editable model and provider connection', async () => {
  const providerId = '11111111-1111-4111-8111-111111111111'
  mocks.api.mockImplementation(async (path: string) => ({ data: path.endsWith('/providers') ? [{ id: providerId, name: 'OpenAI connection' }] : [] }))
  render(<AdminImageModelsPage />)
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/providers'))
  fireEvent.click(screen.getByRole('button', { name: 'Add image model' }))
  fireEvent.change(screen.getByLabelText('Image provider API'), { target: { value: 'openai-images' } })
  expect(screen.getByText('Use https://api.openai.com/v1 and an OpenAI API key with access to GPT Image models.')).toBeTruthy()
  expect((screen.getByLabelText('Upstream model ID') as HTMLInputElement).value).toBe('gpt-image-2.5-flare')
  expect((screen.getByLabelText('Enabled') as HTMLInputElement).checked).toBe(false)
  expect((screen.getByLabelText('Bill users for images') as HTMLInputElement).checked).toBe(false)
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'openai-image' } })
  fireEvent.change(screen.getByLabelText('Upstream model ID'), { target: { value: 'gpt-image-2.5-sunburst' } })
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'OpenAI image editor' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/image-models', { method: 'POST', body: expect.objectContaining({ id: 'openai-image', adapter: 'openai-images', name: 'OpenAI image editor', upstreamModelId: 'gpt-image-2.5-sunburst', enabled: false, billUsers: false, providerConnectionId: providerId }) }))
})
it('loads an existing OpenAI model for editing without overwriting its settings', async () => {
  const existing = { id: 'openai-image', adapter: 'openai-images', name: 'Custom image', upstreamModelId: 'gpt-image-2.5-sunburst', providerConnectionId: '11111111-1111-4111-8111-111111111111', enabled: true, billUsers: true, imagePriceMicros: 20_000, sortOrder: 3 }
  mocks.api.mockImplementation(async (path: string) => ({ data: path.endsWith('/providers') ? [{ id: existing.providerConnectionId, name: 'OpenAI connection' }] : [existing] }))
  render(<AdminImageModelsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  expect((screen.getByLabelText('Image provider API') as HTMLSelectElement).value).toBe('openai-images')
  expect((screen.getByLabelText('Upstream model ID') as HTMLInputElement).value).toBe(existing.upstreamModelId)
  expect((screen.getByLabelText('Enabled') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/image-models/openai-image', { method: 'PATCH', body: existing }))
})
it('creates a disabled Meta preset with the chosen provider and image price', async () => {
  mocks.api.mockImplementation(async (path: string) => ({ data: path.endsWith('/providers') ? [{ id: '11111111-1111-4111-8111-111111111111', name: 'Meta connection' }] : [] }))
  render(<AdminImageModelsPage />)
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/providers'))
  fireEvent.click(screen.getByRole('button', { name: 'Add image model' }))
  fireEvent.change(screen.getByLabelText('Image provider API'), { target: { value: 'meta-muse' } })
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'muse' } })
  expect((screen.getByLabelText('Upstream model ID') as HTMLInputElement).value).toBe('muse-image-1.0')
  expect((screen.getByLabelText('Enabled') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByLabelText('Bill users for images'))
  fireEvent.change(screen.getByLabelText('USD per generated image'), { target: { value: '0.01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/admin/image-models', { method: 'POST', body: expect.objectContaining({ id: 'muse', adapter: 'meta-muse', enabled: false, billUsers: true, imagePriceMicros: 10000, providerConnectionId: '11111111-1111-4111-8111-111111111111' }) }))
})
