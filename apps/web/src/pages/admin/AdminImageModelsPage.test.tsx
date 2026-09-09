// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdminImageModelsPage } from './AdminImageModelsPage'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
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
