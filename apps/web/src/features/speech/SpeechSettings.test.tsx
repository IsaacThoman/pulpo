// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OPENAI_SPEECH_PRESET } from '@pulpo/contracts'
import { SpeechSettings } from './SpeechSettings'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useSettings } from '@/stores/settings'
import { speechPlayback, previewSpeechVoice } from './playback'
vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true }) })
Element.prototype.scrollIntoView = vi.fn()
vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user' } }) }))
vi.mock('./playback', async () => ({
  speechPlayback: new (await import('@pulpo/client-core')).SpeechPlayback(), previewSpeechVoice: vi.fn(),
  speechCatalog: async () => ({ defaultModelId: 'first', data: [
    { ...OPENAI_SPEECH_PRESET, id: 'first', name: 'First model', voices: [{ id: 'coral', label: 'Coral', previewAvailable: true }, { id: 'alloy', label: 'Alloy' }] },
    { ...OPENAI_SPEECH_PRESET, id: 'second', name: 'Second model' },
  ] }),
}))
afterEach(() => { cleanup(); speechPlayback.stop(); vi.clearAllMocks() })
it('allows wheel and touch scrolling inside the voice popup in a modal dialog', async () => {
  useSettings.setState({ speech: { modelId: 'first', models: {} } })
  render(<QueryClientProvider client={new QueryClient()}><Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Settings</DialogTitle><SpeechSettings /></DialogContent></Dialog></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Voice Coral' }))
  const list = screen.getByRole('radiogroup')
  const popup = list.closest('[data-slot="popover-content"]') as HTMLElement
  popup.style.overflowY = 'auto'
  Object.defineProperties(popup, { scrollHeight: { value: 640 }, clientHeight: { value: 320 } })
  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
  fireEvent(list, wheel)
  expect(wheel.defaultPrevented).toBe(false)
  fireEvent.touchStart(list, { changedTouches: [{ clientX: 0, clientY: 200 }] })
  const touch = new Event('touchmove', { bubbles: true, cancelable: true })
  Object.assign(touch, { touches: [{ clientX: 0, clientY: 100 }], changedTouches: [{ clientX: 0, clientY: 100 }] })
  fireEvent(list, touch)
  expect(touch.defaultPrevented).toBe(false)
  const outsideWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
  fireEvent(document.body, outsideWheel)
  expect(outsideWheel.defaultPrevented).toBe(true)
})
it('uses a model dropdown and lets users preview each voice without selecting it', async () => {
  useSettings.setState({ speech: { modelId: 'first', models: { first: { voice: 'alloy', instructions: 'Calm', speed: 1.2 } } } })
  render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  const trigger = await screen.findByRole('button', { name: 'Voice Alloy' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe('First model')
  fireEvent.click(trigger)
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Alloy' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview Coral' }))
  expect(previewSpeechVoice).toHaveBeenCalledWith('first', 'coral')
  expect(useSettings.getState().speech.models.first?.voice).toBe('alloy')
  expect(screen.queryByRole('button', { name: 'Preview Alloy' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: 'Coral' }))
  expect(useSettings.getState().speech.models.first).toEqual({ voice: 'coral', instructions: 'Calm', speed: 1.2 })
  expect(useSettings.getState().speech.modelId).toBe('first')
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.getByRole('button', { name: 'Voice Coral' }).getAttribute('aria-expanded')).toBe('false')
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  fireEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Coral' }), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Alloy' }))
  expect(useSettings.getState().speech.models.first?.voice).toBe('alloy')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
  expect(screen.queryByRole('radio')).toBeNull()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('radio', { name: 'Coral' }))
  expect(screen.queryByRole('radio')).toBeNull()
})
it('dismisses the voice popup with Escape, stops previewing, and restores focus', async () => {
  useSettings.setState({ speech: { modelId: 'first', models: {} } })
  render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  const trigger = await screen.findByRole('button', { name: 'Voice Coral' })
  fireEvent.click(trigger)
  let run: Promise<void> | undefined
  await act(async () => { run = speechPlayback.start('preview:first:coral', ['clip'], async () => ({ dispose() {}, play: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve())) })) })
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await run
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  expect(screen.queryByRole('radio')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})
it('shows an unavailable saved voice without silently selecting a replacement', async () => {
  useSettings.setState({ speech: { modelId: 'first', models: { first: { voice: 'removed', instructions: '', speed: 1 } } } })
  render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Voice Selected voice unavailable' }))
  expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true)
  expect(useSettings.getState().speech.models.first?.voice).toBe('removed')
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

it('shows inherited defaults without persisting them and can clear a voice override', async () => {
  useSettings.setState({ speech: { modelId: null, models: {} } })
  render(<QueryClientProvider client={new QueryClient()}><SpeechSettings /></QueryClientProvider>)
  expect(await screen.findByText('Admin default: First model')).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe('Use admin default')
  expect(screen.getByRole('button', { name: 'Voice Coral' })).toBeTruthy()
  expect(useSettings.getState().speech).toEqual({ modelId: null, models: {} })
  fireEvent.click(screen.getByRole('button', { name: 'Voice Coral' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Alloy' }))
  expect(useSettings.getState().speech.modelId).toBeNull()
  expect(useSettings.getState().speech.models.first?.voice).toBe('alloy')
  fireEvent.click(screen.getByRole('button', { name: 'Use default voice' }))
  expect(useSettings.getState().speech.models.first?.voice).toBeUndefined()
  expect(screen.getByRole('button', { name: 'Voice Coral' })).toBeTruthy()
})
