// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OPENAI_SPEECH_PRESET } from '@pulpo/contracts'
import { SpeechSettings } from './SpeechSettings'
import { useSettings } from '@/stores/settings'
import { speechPlayback, previewSpeechModel } from './playback'
vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true }) })
vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' } }) }))
vi.mock('./playback', async () => ({
  speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeechModel: vi.fn(),
  speechCatalog: async () => ({ data: [
    { ...OPENAI_SPEECH_PRESET, id: 'first', name: 'First model', previewAvailable: true },
    { ...OPENAI_SPEECH_PRESET, id: 'second', name: 'Second model', previewAvailable: false },
  ] }),
}))
afterEach(() => { cleanup(); speechPlayback.stop(); vi.clearAllMocks() })
it('lets users preview separately from selecting and hides play controls when no clip exists', async () => {
  useSettings.setState({ speech: { modelId: 'second', models: {} } })
  render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Preview First model' }))
  expect(previewSpeechModel).toHaveBeenCalledWith('first')
  expect(useSettings.getState().speech.modelId).toBe('second')
  expect(screen.queryByRole('button', { name: 'Preview Second model' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: 'First model' }))
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
