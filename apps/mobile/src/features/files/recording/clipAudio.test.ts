// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  players: [] as Array<{
    uri: string
    options: unknown
    isLoaded: boolean
    currentTime: number
    shouldCorrectPitch: boolean
    listeners: Set<(status: Record<string, unknown>) => void>
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    seekTo: ReturnType<typeof vi.fn>
    setPlaybackRate: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    emit: (status: Record<string, unknown>) => void
  }>,
  loaded: true,
  audioMode: vi.fn(async () => {}),
  download: vi.fn(async () => ({ uri: 'file:///cache/recording-takes/clip.m4a' })),
}))
vi.mock('expo-audio', () => ({
  setAudioModeAsync: native.audioMode,
  createAudioPlayer: (uri: string, options: unknown) => {
    const listeners = new Set<(status: Record<string, unknown>) => void>()
    const player = {
      uri, options, isLoaded: native.loaded, currentTime: 0, shouldCorrectPitch: false, listeners,
      play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(async (seconds: number) => { player.currentTime = seconds }),
      setPlaybackRate: vi.fn(), remove: vi.fn(),
      addListener: (_event: string, listener: (status: Record<string, unknown>) => void) => {
        listeners.add(listener)
        return { remove: () => listeners.delete(listener) }
      },
      emit: (status: Record<string, unknown>) => { for (const listener of [...listeners]) listener(status) },
    }
    native.players.push(player)
    return player
  },
}))
vi.mock('../api', () => ({ downloadRecordingClip: native.download }))

const { loadClipAudio, TAKE_UNPLAYABLE } = await import('./clipAudio')

const clip = { id: '33333333-3333-4333-8333-333333333333', mimeType: 'audio/mp4', sizeBytes: 10 }
afterEach(() => { native.players.length = 0; native.loaded = true; vi.clearAllMocks() })

describe('native take audio', () => {
  it('plays the downloaded take for playback only, keeping pitch at other speeds', async () => {
    const audio = await loadClipAudio('rec', clip, new AbortController().signal)
    const player = native.players[0]!
    expect(native.download).toHaveBeenCalledWith('rec', clip)
    expect(player.uri).toBe('file:///cache/recording-takes/clip.m4a')
    expect(native.audioMode).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false, playsInSilentMode: true }))
    expect(player.shouldCorrectPitch).toBe(true)
    audio.setRate(1.5)
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5, 'high')
    await audio.seek(4)
    expect(audio.currentTime()).toBe(4)
    audio.play()
    expect(player.play).toHaveBeenCalled()
  })

  it('reports the end of the take until it is played or sought again', async () => {
    const audio = await loadClipAudio('rec', clip, new AbortController().signal)
    const player = native.players[0]!
    expect(audio.ended()).toBe(false)
    player.emit({ didJustFinish: true })
    expect(audio.ended()).toBe(true)
    await audio.seek(0)
    expect(audio.ended()).toBe(false)
    audio.dispose()
    expect(player.remove).toHaveBeenCalled()
    expect(player.listeners.size).toBe(0)
  })

  it('waits for the player to load, and fails for audio the device can’t play', async () => {
    native.loaded = false
    const loading = loadClipAudio('rec', clip, new AbortController().signal)
    await vi.waitFor(() => expect(native.players).toHaveLength(1))
    native.players[0]!.emit({ isLoaded: true })
    await expect(loading).resolves.toBeTruthy()

    const failing = loadClipAudio('rec', clip, new AbortController().signal)
    await vi.waitFor(() => expect(native.players).toHaveLength(2))
    native.players[1]!.emit({ playbackState: 'error' })
    await expect(failing).rejects.toThrow(TAKE_UNPLAYABLE)
    expect(native.players[1]!.remove).toHaveBeenCalled()
  })
})
