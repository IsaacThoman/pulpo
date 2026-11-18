import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  currentState: 'active',
  listeners: new Set<(state: string) => void>(),
  getPermission: vi.fn(async () => ({ granted: true })),
  requestPermission: vi.fn(async () => ({ granted: true })),
  prepare: vi.fn(async () => {}), record: vi.fn(), stop: vi.fn(async () => {}), release: vi.fn(),
  remove: vi.fn(), audioMode: vi.fn(async () => {}), request: vi.fn(async () => ({ text: 'Transcript' })),
  recorderOptions: [] as unknown[], metering: -24 as number | undefined,
  os: 'android', events: [] as string[],
  focus: { acquire: vi.fn(async () => true), release: vi.fn(async () => {}) },
  setActive: vi.fn(async (_active: boolean) => {}),
}))
vi.mock('react-native', () => ({ Platform: { get OS() { return native.os } }, AppState: {
  get currentState() { return native.currentState },
  addEventListener: (_event: string, listener: (state: string) => void) => {
    native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) }
  },
} }))
vi.mock('expo-audio', () => ({
  AudioModule: {
    getRecordingPermissionsAsync: native.getPermission,
    requestRecordingPermissionsAsync: native.requestPermission,
    AudioRecorder: class {
      constructor(options: unknown) { native.recorderOptions.push(options) }
      uri = 'file:///recording.m4a'; isRecording = true
      prepareToRecordAsync = native.prepare; record = native.record; stop = native.stop; release = native.release
      getStatus = () => ({ isRecording: true, metering: native.metering })
    },
  },
  RecordingPresets: { HIGH_QUALITY: { android: {}, ios: {} } }, setAudioModeAsync: native.audioMode,
  setIsAudioActiveAsync: native.setActive,
}))
vi.mock('../../../modules/pulpo-audio-focus', () => ({ default: native.focus }))
vi.mock('expo-file-system', () => ({ File: class extends Blob {
  constructor() { super([new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 77, 52, 65, 32])]) }
  exists = true; delete = native.remove
} }))
vi.mock('../../api/client', () => ({ apiRequest: native.request }))
import { createDictationAudioMode, createNativeDictation } from './useDictation'

async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve() }
afterEach(() => {
  vi.clearAllMocks(); vi.useRealTimers(); native.currentState = 'active'; native.listeners.clear(); native.recorderOptions.length = 0; native.metering = -24
  native.os = 'android'; native.events.length = 0
})
function trackAudioEvents() {
  native.focus.acquire.mockImplementation(async () => { native.events.push('focus'); return true })
  native.focus.release.mockImplementation(async () => { native.events.push('unfocus') })
  native.setActive.mockImplementation(async (active) => { native.events.push(active ? 'activate' : 'deactivate') })
  native.record.mockImplementation(() => { native.events.push('record') })
  native.stop.mockImplementation(async () => { native.events.push('stop') })
  native.request.mockImplementation(async () => { native.events.push('transcribe'); return { text: 'Transcript' } })
}
describe('SDK 57 native dictation adapter', () => {
  it('uploads a real multipart Blob with M4A metadata and authentication timeout options', async () => {
    const controller = createNativeDictation(); const apply = vi.fn()
    const run = controller.start(apply); await settle(); controller.stop(); await run
    const [path, options] = native.request.mock.calls[0] as unknown as [string, { body: FormData; signal: AbortSignal; timeoutMs: number }]
    expect(path).toBe('/api/dictation/transcriptions')
    expect(options.timeoutMs).toBe(45_000)
    expect(options.signal.aborted).toBe(false)
    const file = options.body.get('file') as File
    expect(file).toBeInstanceOf(Blob)
    expect(file.type).toBe('audio/mp4'); expect(file.name).toBe('dictation.m4a'); expect(file.size).toBe(12)
    expect(native.requestPermission).not.toHaveBeenCalled()
    expect(native.remove).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledWith('Transcript')
  })
  it('waits for foreground after the permission activity resolves', async () => {
    native.getPermission.mockResolvedValueOnce({ granted: false })
    native.requestPermission.mockImplementationOnce(async () => { native.currentState = 'background'; return { granted: true } })
    const controller = createNativeDictation(); const run = controller.start(vi.fn()); await settle()
    expect(native.record).not.toHaveBeenCalled()
    native.currentState = 'active'; native.listeners.forEach((listener) => listener('active'))
    await settle(); expect(native.record).toHaveBeenCalledOnce()
    controller.cancel(); await run
    expect(native.request).not.toHaveBeenCalled()
  })
  it('does not start recording if the app stays backgrounded after permission', async () => {
    vi.useFakeTimers(); native.currentState = 'background'
    const controller = createNativeDictation(); const run = controller.start(vi.fn()); await settle()
    await vi.advanceTimersByTimeAsync(1000); await run
    expect(native.record).not.toHaveBeenCalled(); expect(native.listeners.size).toBe(0)
    expect(controller.getSnapshot().error).toContain('interrupted')
  })
  it('enables native metering and feeds recorder levels to the waveform', async () => {
    vi.useFakeTimers()
    const controller = createNativeDictation(); const run = controller.start(vi.fn()); await settle()
    expect(native.recorderOptions[0]).toMatchObject({ isMeteringEnabled: true })
    await vi.advanceTimersByTimeAsync(80)
    expect(controller.getLevels().at(-1)).toBeGreaterThan(0)
    native.metering = undefined
    await vi.advanceTimersByTimeAsync(80)
    expect(controller.getLevels().at(-1)).toBe(0)
    controller.cancel(); await run
  })
  it('pauses other apps on Android with audio focus and gives it back before transcribing', async () => {
    trackAudioEvents()
    const controller = createNativeDictation(); const run = controller.start(vi.fn()); await settle(); controller.stop(); await run
    expect(native.events).toEqual(['focus', 'record', 'stop', 'unfocus', 'transcribe'])
    expect(native.setActive).not.toHaveBeenCalled()
    expect(native.audioMode).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: true, interruptionMode: 'doNotMix' }))
    expect(native.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false })
  })
  it('records without mixing on iOS and deactivates the session so other apps resume', async () => {
    native.os = 'ios'; trackAudioEvents()
    const controller = createNativeDictation(); const run = controller.start(vi.fn()); await settle(); controller.stop(); await run
    expect(native.events).toEqual(['record', 'stop', 'deactivate', 'transcribe'])
    expect(native.focus.acquire).not.toHaveBeenCalled()
    expect(native.audioMode).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: true, interruptionMode: 'doNotMix' }))
  })
  it('resumes other apps when dictation is cancelled', async () => {
    trackAudioEvents()
    const controller = createNativeDictation(); const run = controller.start(vi.fn()); await settle(); controller.cancel(); await run
    expect(native.events).toEqual(['focus', 'record', 'stop', 'unfocus'])
  })
  it('leaves other audio alone when recording never started', async () => {
    native.os = 'ios'; native.getPermission.mockResolvedValueOnce({ granted: false }); native.requestPermission.mockResolvedValueOnce({ granted: false })
    const controller = createNativeDictation(); await controller.start(vi.fn())
    expect(native.setActive).not.toHaveBeenCalled(); expect(native.focus.release).not.toHaveBeenCalled()
  })
  it('retries handing audio back if the session is still busy, without failing dictation', async () => {
    native.os = 'ios'
    native.setActive.mockRejectedValueOnce(new Error('Session is busy'))
    const audioMode = createDictationAudioMode(native.focus)
    await audioMode(true)
    await expect(audioMode(false)).resolves.toBeUndefined()
    await audioMode(false)
    expect(native.setActive).toHaveBeenCalledTimes(2)
    await audioMode(false)
    expect(native.setActive).toHaveBeenCalledTimes(2)
  })
})
