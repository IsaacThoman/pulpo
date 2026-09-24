// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SpeechAudio } from '@pulpo/client-core'
import { SpeechPlayer } from './SpeechPlayer'
import { speechPlayback } from './state'

afterEach(() => { cleanup(); speechPlayback.stop(); speechPlayback.setRate(1) })

function clip() {
  const audio = { time: 3, dispose: vi.fn(), play: (signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
    pause: vi.fn(), resume: vi.fn(), seek: vi.fn((seconds: number) => { audio.time = seconds }), currentTime: () => audio.time, duration: () => 65, setRate: vi.fn() }
  return audio satisfies SpeechAudio
}

it('stays hidden for settings previews and idle playback', async () => {
  render(<SpeechPlayer />)
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
  await act(async () => { void speechPlayback.start('preview:settings', ['a'], async () => clip()) })
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
})

it('pauses, seeks, changes speed, and stops message playback', async () => {
  const audio = clip()
  render(<SpeechPlayer />)
  await act(async () => { void speechPlayback.start('chat:message', ['Hello'], async () => audio) })
  expect(screen.getByRole('region', { name: 'Read aloud controls' })).toBeTruthy()
  expect(screen.getByText('0:03 / 1:05')).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5')

  fireEvent.click(screen.getByRole('button', { name: 'Pause reading' }))
  expect(audio.pause).toHaveBeenCalledOnce(); expect(screen.getByText('Paused')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Resume reading' }))
  expect(audio.resume).toHaveBeenCalledOnce()

  fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' })); expect(audio.time).toBe(13)
  fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' })); expect(audio.time).toBe(3)

  fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1×' }))
  expect(audio.setRate).toHaveBeenLastCalledWith(1.25); expect(screen.getByRole('button', { name: 'Playback speed 1.25×' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }))
  expect(speechPlayback.getSnapshot().key).toBeNull()
  expect(screen.queryByRole('region', { name: 'Read aloud controls' })).toBeNull()
})
