// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VOXTRAL_SPEECH_PRESET, type SpeechModelCatalogEntry } from '@pulpo/contracts'
import { SpeechVoiceAssetsEditor, MistralVoiceDiscovery } from './SpeechVoiceAssetsEditor'
import { apiRequest, fetchApiBlob } from '@/lib/api'
vi.mock('@/lib/api', () => ({ apiRequest: vi.fn(async () => ({})), fetchApiBlob: vi.fn(async () => new Blob()) }))
vi.mock('@/features/speech/playback', async () => ({ speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), browserSpeechAudio: () => ({ play: async () => {}, dispose: () => {} }) }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string, values?: Record<string, unknown>) => text.replace(/{{(\w+)}}/g, (_, key) => String(values?.[key] ?? '')) }))
const model: SpeechModelCatalogEntry = { ...VOXTRAL_SPEECH_PRESET, id: 'voxtral', providerConnectionId: '11111111-1111-4111-8111-111111111111', voices: [{ id: 'local', label: 'My voice', watermark: { enabled: false, volume: 0.15 }, watermarkAvailable: true, referenceAvailable: true, kind: 'cloned' }], defaultVoice: 'local' }
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('uploads cloning references separately from watermarks and reloads published assets', async () => {
  const onSaved = vi.fn(async () => {})
  render(<SpeechVoiceAssetsEditor model={model} voice={model.voices[0]!} disabled={false} onSaved={onSaved} onError={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Cloning reference for My voice'), { target: { files: [new File(['reference'], 'clip.m4a')] } })
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/voxtral/voices/local/clone', expect.objectContaining({ method: 'POST', body: expect.any(FormData) })))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByLabelText('Watermark clip for My voice'), { target: { files: [new File(['mark'], 'clip.mp3')] } })
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/voxtral/voices/local/watermark', expect.objectContaining({ method: 'POST', body: expect.any(FormData) })))
})
it('preserves watermark volume when enabling and generates a user preview through the server', async () => {
  render(<SpeechVoiceAssetsEditor model={model} voice={model.voices[0]!} disabled={false} onSaved={async () => {}} onError={vi.fn()} />)
  fireEvent.click(screen.getByLabelText('Enable watermark'))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/speech-models/voxtral/voices/local/watermark', { method: 'PATCH', body: { enabled: true, volume: 0.15 } }))
  fireEvent.click(screen.getByText('Generate user preview'))
  await waitFor(() => expect(fetchApiBlob).toHaveBeenCalledWith('/api/admin/speech-models/voxtral/voices/local/test', expect.objectContaining({ method: 'POST', body: JSON.stringify({ input: 'Hello. This is a sample of my voice.', savePreview: true }) })))
})
it('requires a saved model and keeps reference controls exclusive to Mistral', () => {
  const { rerender } = render(<SpeechVoiceAssetsEditor model={model} voice={model.voices[0]!} disabled onSaved={async () => {}} onError={vi.fn()} />)
  expect(screen.getByText('Save the model and voice before managing audio assets.')).toBeTruthy()
  expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
  rerender(<SpeechVoiceAssetsEditor model={{ ...model, adapter: 'openai' }} voice={model.voices[0]!} disabled={false} onSaved={async () => {}} onError={vi.fn()} />)
  expect(screen.queryByLabelText('Cloning reference for My voice')).toBeNull()
  expect(screen.getByLabelText('Watermark clip for My voice')).toBeTruthy()
})
it('imports selected provider voices while retaining existing names and watermark settings', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ data: [{ id: 'new', name: 'Provider voice', languages: ['fr'], custom: false }] })
  const onImport = vi.fn()
  render(<MistralVoiceDiscovery modelId={model.id} voices={model.voices} disabled={false} onImport={onImport} onError={vi.fn()} />)
  fireEvent.click(screen.getByText('Load Mistral voices'))
  fireEvent.click(await screen.findByText('Add voice'))
  expect(onImport).toHaveBeenCalledWith([...model.voices, { id: 'new', label: 'Provider voice', kind: 'provider' }])
})
