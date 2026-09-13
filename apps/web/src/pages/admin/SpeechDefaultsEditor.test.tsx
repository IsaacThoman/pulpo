// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPENAI_SPEECH_PRESET } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { SpeechDefaultsEditor } from './SpeechDefaultsEditor'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string, values?: Record<string, unknown>) => text.replace(/{{(\w+)}}/g, (_, key) => String(values?.[key] ?? '')) }))
const model = { ...OPENAI_SPEECH_PRESET, id: 'speech', providerConnectionId: 'provider', enabled: true }
beforeEach(() => vi.mocked(apiRequest).mockReset().mockImplementation(async (path, options) => path === '/api/admin/settings/speech' ? options?.body ?? { modelId: null } : { data: [model] }))
afterEach(cleanup)

it('saves and clears a default, showing the model’s default voice', async () => {
  render(<SpeechDefaultsEditor models={[model]} />)
  const select = screen.getByRole('combobox', { name: 'Default speech model' })
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false))
  fireEvent.change(select, { target: { value: 'speech' } })
  expect(screen.getByText('Default voice: coral')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save default' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/settings/speech', { method: 'PATCH', body: { modelId: 'speech' } }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save default' }) as HTMLButtonElement).disabled).toBe(true))
  fireEvent.change(select, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save default' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/settings/speech', { method: 'PATCH', body: { modelId: null } }))
})
it('keeps a failed save editable and reports the error', async () => {
  render(<SpeechDefaultsEditor models={[model]} />)
  const select = screen.getByRole('combobox')
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false))
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Unable to save'))
  fireEvent.change(select, { target: { value: 'speech' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save default' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to save')
  expect((screen.getByRole('button', { name: 'Save default' }) as HTMLButtonElement).disabled).toBe(false)
})
it('shows unavailable defaults and lets admins clear them', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path === '/api/admin/settings/speech' ? { modelId: 'disabled' } : { data: [] })
  render(<SpeechDefaultsEditor models={[model]} />)
  expect(await screen.findByText('The default model or its provider is unavailable. Choose an enabled model or clear the default.')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  expect((screen.getByRole('button', { name: 'Save default' }) as HTMLButtonElement).disabled).toBe(false)
})
