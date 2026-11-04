// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render as renderElement, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { SpeechAudio } from '@pulpo/client-core'
import { downloadBlob } from '@/lib/code-download'
import { useFileToasts } from '@/features/files/browser/toasts'
import { useAuth } from '@/stores/auth'
import { SpeechPlayer } from './SpeechPlayer'
import { speechPlayback } from './state'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
vi.mock('@/lib/code-download', () => ({ downloadBlob: vi.fn() }))
const render = (element: ReactElement) => renderElement(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>)

afterEach(() => { cleanup(); speechPlayback.stop(); speechPlayback.setRate(1); vi.mocked(downloadBlob).mockClear(); useFileToasts.setState({ toasts: [] }); useAuth.setState({ filesEnabled: true }) })

function clip() {
  const audio = { time: 3, dispose: vi.fn(), play: (signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
    pause: vi.fn(), resume: vi.fn(), seek: vi.fn((seconds: number) => { audio.time = seconds }), currentTime: () => audio.time, duration: () => 65, setRate: vi.fn() }
  return audio satisfies SpeechAudio
}

it('only appears beneath the message being read', async () => {
  render(<SpeechPlayer messageKey="chat:message" />)
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
  await act(async () => { void speechPlayback.start('chat:other', ['a'], async () => clip()) })
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
})

it('pauses, seeks, and changes speed, and hides when playback stops', async () => {
  const audio = clip()
  render(<SpeechPlayer messageKey="chat:message" />)
  await act(async () => { void speechPlayback.start('chat:message', ['Hello'], async () => audio) })
  expect(screen.getByRole('region', { name: 'Read aloud controls' })).toBeTruthy()
  expect(screen.getByText('0:03 / 1:05')).toBeTruthy()
  expect((screen.getByRole('slider', { name: 'Reading position' }) as HTMLInputElement).value).toBe('3')

  fireEvent.click(screen.getByRole('button', { name: 'Pause reading' }))
  expect(audio.pause).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Resume reading' }))
  expect(audio.resume).toHaveBeenCalledOnce()

  const slider = screen.getByRole('slider', { name: 'Reading position' })
  fireEvent.change(slider, { target: { value: '40' } }); expect(screen.getByText('0:40 / 1:05')).toBeTruthy(); expect(audio.seek).not.toHaveBeenCalled()
  fireEvent.pointerUp(slider); expect(audio.time).toBe(40)
  audio.time = 3
  fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' })); expect(audio.time).toBe(13)
  fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' })); expect(audio.time).toBe(3)

  fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1×' }))
  expect(audio.setRate).toHaveBeenLastCalledWith(1.25); expect(screen.getByRole('button', { name: 'Playback speed 1.25×' })).toBeTruthy()

  act(() => speechPlayback.stop())
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
})

it('stays after a retained playback ends, replays its audio, and closes', async () => {
  let finish = () => {}
  const audio = { ...clip(), play: vi.fn((signal: AbortSignal) => new Promise<void>(resolve => { finish = resolve; signal.addEventListener('abort', () => resolve(), { once: true }) })) }
  const generate = vi.fn(async () => audio)
  render(<SpeechPlayer messageKey="chat:message" />)
  await act(async () => { void speechPlayback.start('chat:message', ['Hello'], generate, { retain: true }) })
  await act(async () => { finish() })
  expect(screen.getByRole('region', { name: 'Read aloud controls' })).toBeTruthy()
  expect(screen.getByText('1:05 / 1:05')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Forward 10 seconds' }) as HTMLButtonElement).disabled).toBe(true)

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Replay' })) })
  expect(audio.play).toHaveBeenCalledTimes(2); expect(audio.seek).toHaveBeenLastCalledWith(0); expect(generate).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Pause reading' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Close player' }))
  expect(speechPlayback.getSnapshot().key).toBeNull()
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
})

it('downloads the whole message as one file, generating the rest first', async () => {
  const wav = (sample: number) => new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([36, 0, 0, 0], [...'WAVEfmt '].map(c => c.charCodeAt(0)), [16, 0, 0, 0, 1, 0, 1, 0, 0xc0, 0x5d, 0, 0, 0x80, 0xbb, 0, 0, 2, 0, 16, 0], [...'data'].map(c => c.charCodeAt(0)), [2, 0, 0, 0, sample, 0]))
  let first: (audio: SpeechAudio) => void = () => {}
  const generate = vi.fn()
    .mockReturnValueOnce(new Promise<SpeechAudio>(resolve => { first = resolve }))
    .mockImplementation(async () => ({ ...clip(), format: 'wav' as const, bytes: () => wav(generate.mock.calls.length) }))
  render(<SpeechPlayer messageKey="chat:message" />)
  await act(async () => { void speechPlayback.start('chat:message', ['Hello there', 'and', 'goodbye'], generate, { retain: true }) })
  // With Files, one menu offers a download or a copy in Files; until the first chunk exists there is nothing to save.
  expect((screen.getByRole('button', { name: 'Save audio' }) as HTMLButtonElement).disabled).toBe(true)
  act(() => useAuth.setState({ filesEnabled: false }))
  expect((screen.getByRole('button', { name: 'Download audio' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { first({ ...clip(), format: 'wav', bytes: () => wav(1) }) })

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download audio' })) })
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce())
  const [blob, name] = vi.mocked(downloadBlob).mock.calls[0]!
  expect(name).toBe('Hello there and goodbye.wav'); expect(blob.type).toBe('audio/wav')
  // jsdom's Blob has no arrayBuffer().
  const bytes = await new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob) })
  expect(Array.from(new Uint8Array(bytes).slice(44))).toEqual([1, 0, 2, 0, 3, 0])
  expect(generate).toHaveBeenCalledTimes(3)
  expect(speechPlayback.getSnapshot()).toMatchObject({ key: 'chat:message', phase: 'playing' })
})

it('reports audio that cannot be saved', async () => {
  useAuth.setState({ filesEnabled: false })
  render(<SpeechPlayer messageKey="chat:message" />)
  await act(async () => { void speechPlayback.start('chat:message', ['Hello'], async () => clip()) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download audio' })) })
  await waitFor(() => expect(useFileToasts.getState().toasts).toMatchObject([{ message: 'This speech audio cannot be saved', tone: 'error' }]))
  expect(downloadBlob).not.toHaveBeenCalled()
})
