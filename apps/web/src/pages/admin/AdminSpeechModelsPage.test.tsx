// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPENAI_SPEECH_PRESET, SPEECH_DEFAULT_PREVIEW_TEXT } from '@pulpo/contracts'
import { AdminSpeechModelsPage } from './AdminSpeechModelsPage'
import { apiRequest } from '@/lib/api'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }))
vi.mock('@/features/speech/playback', async () => ({ speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback() }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string, values?: Record<string, unknown>) => text.replace(/{{(\w+)}}/g, (_, key) => String(values?.[key] ?? '')) }))
const model = { ...OPENAI_SPEECH_PRESET, id: 'speech', providerConnectionId: '11111111-1111-4111-8111-111111111111',
  voices: [{ id: 'coral', label: 'Warm voice' }, { id: 'custom', label: 'Custom voice' }], defaultVoice: 'coral' }
beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => path === '/api/admin/providers'
    ? { data: [{ id: model.providerConnectionId, name: 'Provider' }] }
    : path === '/api/admin/settings/speech' ? { modelId: null } : { data: [model] })
})
afterEach(cleanup)
const edit = async () => { render(<AdminSpeechModelsPage />); fireEvent.click(await screen.findByRole('button', { name: 'Edit' })) }

it('saves provider limits above the preset ceilings and permits no token limit', async () => {
  await edit()
  fireEvent.change(screen.getByLabelText('Maximum input characters'), { target: { value: '100000' } })
  fireEvent.change(screen.getByLabelText('Token limit (blank for none)'), { target: { value: '64000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech', expect.objectContaining({ body: expect.objectContaining({ maxInputCharacters: 100000, maxInputTokens: 64000 }) })))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Token limit (blank for none)'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech', expect.objectContaining({ body: expect.objectContaining({ maxInputTokens: null }) })))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it.each(['0', '-1', '1.001'])('shows a readable field error for invalid limit %s and allows correction', async value => {
  await edit()
  fireEvent.change(screen.getByLabelText('Maximum input characters'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getAllByRole('alert').every(alert => alert.textContent === 'Maximum input characters: Enter a positive whole number.')).toBe(true))
  expect(apiRequest).not.toHaveBeenCalledWith('/api/admin/speech-models/speech', expect.anything())
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false)
  fireEvent.change(screen.getByLabelText('Maximum input characters'), { target: { value: '8192' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('edits per-voice preview text with the shared default and no upload controls', async () => {
  await edit()
  const text = screen.getByLabelText('Preview text for Warm voice') as HTMLTextAreaElement
  expect(text.placeholder).toBe(SPEECH_DEFAULT_PREVIEW_TEXT)
  expect(text.maxLength).toBe(500)
  expect(screen.queryByLabelText('Preview file for Warm voice')).toBeNull()
  expect(screen.queryByText('Generate user preview')).toBeNull()
  fireEvent.change(text, { target: { value: 'Warm hello' } })
  fireEvent.change(screen.getByLabelText('Preview text for Custom voice'), { target: { value: 'Custom hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Load preset voices' }))
  expect(text.value).toBe('Warm hello')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech', expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ voices: expect.arrayContaining([
    { id: 'coral', label: 'Warm voice', previewText: 'Warm hello' }, { id: 'custom', label: 'Custom voice', previewText: 'Custom hello' },
  ]) }) }))
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/preview'))).toBe(false)
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

it('sends null to reset a voice to the default text', async () => {
  await edit()
  const text = screen.getByLabelText('Preview text for Warm voice')
  fireEvent.change(text, { target: { value: 'Custom' } })
  fireEvent.change(text, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/speech', expect.objectContaining({ body: expect.objectContaining({ voices: [{ ...model.voices[0], previewText: null }, model.voices[1]] }) }))
})
