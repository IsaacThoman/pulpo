// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPENAI_SPEECH_PRESET } from '@pulpo/contracts'
import { AdminSpeechModelsPage } from './AdminSpeechModelsPage'
import { apiRequest } from '@/lib/api'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }))
vi.mock('@/features/speech/playback', async () => ({ speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeechFile: vi.fn(), previewSpeechVoice: vi.fn() }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string, values?: Record<string, unknown>) => text.replace(/{{(\w+)}}/g, (_, key) => String(values?.[key] ?? '')) }))
const model = { ...OPENAI_SPEECH_PRESET, id: 'speech', providerConnectionId: '11111111-1111-4111-8111-111111111111',
  voices: [{ id: 'coral', label: 'Warm voice', previewAvailable: true }, { id: 'custom', label: 'Custom voice' }], defaultVoice: 'coral' }
beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => path === '/api/admin/providers'
    ? { data: [{ id: model.providerConnectionId, name: 'Provider' }] }
    : { data: [model] })
})
afterEach(cleanup)
const edit = async () => { render(<AdminSpeechModelsPage />); fireEvent.click(await screen.findByRole('button', { name: 'Edit' })) }

it('uploads the optional clip after saving the model and removes it only on save', async () => {
  await edit()
  fireEvent.change(screen.getByLabelText('Preview file for Warm voice'), { target: { files: [new File(['sample'], 'sample.wav', { type: 'audio/wav' })] } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech/voices/coral/preview', expect.objectContaining({ method: 'POST', body: expect.any(FormData) })))
  const calls = vi.mocked(apiRequest).mock.calls
  const saveIndex = calls.findIndex(([path, options]) => path === '/api/admin/speech-models/speech' && options?.method === 'PATCH')
  const uploadIndex = calls.findIndex(([path]) => path.endsWith('/preview'))
  expect(uploadIndex).toBeGreaterThan(saveIndex)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove preview for Warm voice' }))
  expect(apiRequest).not.toHaveBeenCalledWith('/api/admin/speech-models/speech/voices/coral/preview', { method: 'DELETE' })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech/voices/coral/preview', { method: 'DELETE' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('keeps the selected default when renamed and requires a replacement after removal', async () => {
  await edit()
  fireEvent.change(screen.getByLabelText('Voice ID 1'), { target: { value: 'renamed' } })
  expect((screen.getByLabelText('Use voice 1 as default') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech', expect.objectContaining({
    method: 'PATCH', body: expect.objectContaining({ defaultVoice: 'renamed', voices: [{ id: 'renamed', label: 'Warm voice' }, model.voices[1]] }),
  })))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByLabelText('Remove voice 1'))
  expect(screen.getByText('Choose a default voice.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Use voice 1 as default'))
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
})

it('preserves existing names during preset loading and validates pasted or new rows before saving', async () => {
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Load preset voices' }))
  expect((screen.getByLabelText('Voice display name 1') as HTMLInputElement).value).toBe('Warm voice')
  expect((screen.getByLabelText('Voice display name 2') as HTMLInputElement).value).toBe('Custom voice')
  expect(screen.getAllByRole('radio')).toHaveLength(14)
  fireEvent.click(screen.getByText('Bulk paste'))
  fireEvent.change(screen.getByLabelText('Enter one voice ID per line, optionally followed by | display name.'), { target: { value: 'coral | Duplicate\nnew-voice | New voice' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add pasted voices' }))
  expect(screen.getAllByText('Voice IDs must be unique.')).toHaveLength(2)
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Voice ID 15'), { target: { value: 'unique' } })
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Add voice' }))
  expect(screen.getByText('Enter a voice ID.')).toBeTruthy()
  expect(screen.getByText('Enter a display name.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
})

it('saves different samples for individual voices and never uploads one model-wide clip', async () => {
  await edit()
  const warm = new File(['warm'], 'warm.wav', { type: 'audio/wav' })
  const custom = new File(['custom'], 'custom.mp3', { type: 'audio/mpeg' })
  fireEvent.change(screen.getByLabelText('Preview file for Warm voice'), { target: { files: [warm] } })
  fireEvent.change(screen.getByLabelText('Preview file for Custom voice'), { target: { files: [custom] } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const uploads = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/preview'))
  expect(uploads.map(([path]) => path)).toEqual(['/api/admin/speech-models/speech/voices/coral/preview', '/api/admin/speech-models/speech/voices/custom/preview'])
  expect((uploads[0]![1]!.body as FormData).get('file')).toBe(warm)
  expect((uploads[1]![1]!.body as FormData).get('file')).toBe(custom)
})
