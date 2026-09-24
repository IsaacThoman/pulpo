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
