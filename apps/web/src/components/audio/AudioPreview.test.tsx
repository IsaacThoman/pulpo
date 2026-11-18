// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { AudioPreview } from './AudioPreview'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest: vi.fn() }))

const transcript = {
  text: 'Hello there. General remarks.',
  durationSeconds: 30,
  segments: [{ start: 0, end: 12, text: 'Hello there.' }, { start: 12, end: 30, text: 'General remarks.' }],
}

function renderPlayer(props: Partial<Parameters<typeof AudioPreview>[0]> = {}) {
  const client = new QueryClient()
  const view = render(
    <QueryClientProvider client={client}>
      <AudioPreview src="blob:memo" name="memo.mp3" mimeType="audio/mpeg" sizeBytes={1024} source={{ kind: 'attachment', id: 'att-1' }} {...props} />
    </QueryClientProvider>,
  )
  const audio = view.container.querySelector('audio')!
  Object.defineProperty(audio, 'duration', { configurable: true, value: 30 })
  act(() => { audio.dispatchEvent(new Event('loadedmetadata')) })
  return { view, audio }
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'user-1' } as never, dictationEnabled: true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    this.dispatchEvent(new Event('play'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
    this.dispatchEvent(new Event('pause'))
  })
  vi.mocked(apiRequest).mockReset().mockResolvedValue(transcript)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('audio preview', () => {
  it('plays and seeks the audio', async () => {
    const { view, audio } = renderPlayer()
    expect(view.getByText('0:30')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Play' }))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(await view.findByRole('button', { name: 'Pause' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(audio.currentTime).toBe(10)
  })

  it('transcribes on request and follows along with playback', async () => {
    const { view, audio } = renderPlayer()
    expect(apiRequest).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Transcribe' }))
    expect(apiRequest).toHaveBeenCalledWith('/api/attachments/att-1/transcription', { method: 'POST' })

    const second = await view.findByRole('button', { name: 'Play from 0:12: General remarks.' })
    const first = view.getByRole('button', { name: 'Play from 0:00: Hello there.' })
    expect(first.getAttribute('aria-current')).toBe('true')

    fireEvent.click(second)
    expect(audio.currentTime).toBe(12)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    act(() => { audio.dispatchEvent(new Event('timeupdate')) })
    await waitFor(() => expect(second.getAttribute('aria-current')).toBe('true'))
    expect(first.getAttribute('aria-current')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Hide transcript' }))
    expect(view.queryByTestId('audio-transcript')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Show transcript' }))
    expect(view.getByTestId('audio-transcript')).toBeTruthy()
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when transcription fails', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'))
    const { view } = renderPlayer()
    fireEvent.click(view.getByRole('button', { name: 'Transcribe' }))
    fireEvent.click(await view.findByRole('button', { name: 'Try again' }))
    expect(await view.findByRole('button', { name: 'Play from 0:00: Hello there.' })).toBeTruthy()
    expect(apiRequest).toHaveBeenCalledTimes(2)
  })

  it('does not offer transcription without dictation, storage, or a supported format', () => {
    useAuth.setState({ dictationEnabled: false })
    expect(renderPlayer().view.queryByRole('button', { name: 'Transcribe' })).toBeNull()
    cleanup()
    useAuth.setState({ dictationEnabled: true })
    expect(renderPlayer({ source: null }).view.queryByRole('button', { name: 'Transcribe' })).toBeNull()
    cleanup()
    expect(renderPlayer({ name: 'clip.aac', mimeType: 'audio/aac' }).view.queryByRole('button', { name: 'Transcribe' })).toBeNull()
  })
})
