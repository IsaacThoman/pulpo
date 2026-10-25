// @vitest-environment node
import { RECORDING_AUDIO_BITS_PER_SECOND } from '@pulpo/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  options: [] as unknown[],
  record: vi.fn(), pause: vi.fn(), stop: vi.fn(async () => {}), release: vi.fn(),
  audioMode: vi.fn(async () => {}),
  awake: vi.fn(async () => {}), asleep: vi.fn(async () => {}),
  removed: [] as string[],
  granted: true,
  duration: 0,
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) } }))
vi.mock('expo-audio', () => ({
  AudioModule: {
    getRecordingPermissionsAsync: async () => ({ granted: native.granted }),
    requestRecordingPermissionsAsync: async () => ({ granted: native.granted }),
    AudioRecorder: class {
      uri = 'file:///cache/take.m4a'
      constructor(options: unknown) { native.options.push(options) }
      prepareToRecordAsync = async () => {}
      record = native.record; pause = native.pause; stop = native.stop; release = native.release
      getStatus = () => ({ isRecording: true, durationMillis: native.duration, metering: -18 })
    },
  },
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { HIGH: 96 },
  setAudioModeAsync: native.audioMode,
}))
vi.mock('expo-file-system', () => ({ File: class { exists = true; constructor(readonly uri: string) {} delete() { native.removed.push(this.uri) } } }))
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: native.awake, deactivateKeepAwake: native.asleep }))

const { createNativeTakeRecorder } = await import('./nativeRecorder')

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); native.options.length = 0; native.removed.length = 0; native.granted = true; native.duration = 0 })

describe('native take recorder', () => {
  it('records metered mono AAC at the bit rate the server keeps, with the screen kept on', async () => {
    vi.useFakeTimers()
    const controller = createNativeTakeRecorder()
    const takes: unknown[] = []
    await controller.start((take) => takes.push(take))
    expect(native.options[0]).toMatchObject({ extension: '.m4a', numberOfChannels: 1, bitRate: RECORDING_AUDIO_BITS_PER_SECOND, isMeteringEnabled: true })
    expect(native.audioMode).toHaveBeenCalledWith({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false })
    expect(native.awake).toHaveBeenCalledWith('pulpo-voice-recording')
    native.duration = 1_200
    await vi.advanceTimersByTimeAsync(160)
    await controller.stop()
    expect(takes).toEqual([expect.objectContaining({ uri: 'file:///cache/take.m4a', durationMs: 1_200 })])
    expect(native.asleep).toHaveBeenCalledWith('pulpo-voice-recording')
    expect(native.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false })
  })

  it('removes a discarded take’s file', async () => {
    const controller = createNativeTakeRecorder()
    await controller.start(() => undefined)
    controller.cancel()
    await vi.waitFor(() => expect(native.removed).toEqual(['file:///cache/take.m4a']))
  })

  it('asks for the microphone and explains when it is denied', async () => {
    native.granted = false
    const controller = createNativeTakeRecorder()
    await controller.start(() => undefined)
    expect(native.options).toEqual([])
    expect(controller.getSnapshot().error).toContain('Microphone access is denied')
  })
})
