// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OPENAI_SPEECH_PRESET } from '@pulpo/contracts'
import { SpeechSettings } from './SpeechSettings'
import { useSettings } from '@/stores/settings'
import { speechPlayback, previewSpeechVoice } from './playback'
vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true }) })
vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' } }) }))
vi.mock('./playback', async () => ({
  speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeechVoice: vi.fn(),
  speechCatalog: async () => ({ data: [
    { ...OPENAI_SPEECH_PRESET, id: 'first', name: 'First model', voices: [{ id: 'coral', label: 'Coral', previewAvailable: true }, { id: 'alloy', label: 'Alloy' }] },
    { ...OPENAI_SPEECH_PRESET, id: 'second', name: 'Second model' },
  ] }),
}))
afterEach(() => { cleanup(); speechPlayback.stop(); vi.clearAllMocks() })
it('uses a model dropdown and lets users preview each voice without selecting it', async () => {
  useSettings.setState({ speech: { modelId: 'first', models: { first: { voice: 'alloy', instructions: 'Calm', speed: 1.2 } } } })
  render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Coral' }))
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe('First model')
  expect(previewSpeechVoice).toHaveBeenCalledWith('first', 'coral')
  expect(useSettings.getState().speech.models.first?.voice).toBe('alloy')
  expect(screen.queryByRole('button', { name: 'Preview Alloy' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: 'Coral' }))
  expect(useSettings.getState().speech.models.first).toEqual({ voice: 'coral', instructions: 'Calm', speed: 1.2 })
  expect(useSettings.getState().speech.modelId).toBe('first')
})
it('stops an active preview when leaving settings and preserves unavailable selections', async () => {
  useSettings.setState({ speech: { modelId: 'removed', models: {} } })
  const view = render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  expect(await screen.findByText('Selected model unavailable')).toBeTruthy()
  expect(useSettings.getState().speech.modelId).toBe('removed')
  const run = speechPlayback.start('preview:first', ['clip'], async () => ({ dispose() {}, play: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve())) }))
  view.unmount(); await run
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
})
