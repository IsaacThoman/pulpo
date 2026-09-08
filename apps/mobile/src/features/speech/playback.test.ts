import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  appState: 'active', onAppState: undefined as undefined | ((state: string) => void),
  onSession: undefined as undefined | ((state: unknown, previous: unknown) => void),
  status: undefined as undefined | ((status: { didJustFinish?: boolean; playbackState?: string }) => void),
  play: vi.fn(), pause: vi.fn(), remove: vi.fn(), deleteFile: vi.fn(), write: vi.fn(), audioMode: vi.fn(),
  preferences: { modelId: 'speech', models: {} }, request: vi.fn(),
}))
vi.mock('react-native', () => ({ AppState: { get currentState() { return mocks.appState }, addEventListener: (_event: string, fn: typeof mocks.onAppState) => { mocks.onAppState = fn } } }))
vi.mock('expo-audio', () => ({ setAudioModeAsync: mocks.audioMode, createAudioPlayer: () => ({ play: mocks.play, pause: mocks.pause, remove: mocks.remove, addListener: (_event: string, listener: typeof mocks.status) => { mocks.status = listener; return { remove: vi.fn() } } }) }))
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' }, Directory: class { exists = false; delete() {} create() {} },
  File: class { exists = true; uri = 'cache/speech/audio.wav'; write = mocks.write; delete = mocks.deleteFile },
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }))
vi.mock('../../api/client', () => ({ apiRequest: mocks.request, apiUrl: (url: string) => `https://instance.example${url}`, nativeAuthorizationHeaders: () => ({ authorization: 'Bearer session' }) }))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: { getState: () => ({ speech: mocks.preferences }) } }))
vi.mock('../../store/session', () => ({ useSessionStore: { subscribe: (fn: typeof mocks.onSession) => { mocks.onSession = fn } } }))
import { speechPlayback, readAloud, previewSpeechModel } from './playback'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
beforeEach(() => {
  speechPlayback.stop(); vi.clearAllMocks(); mocks.appState = 'active'
  mocks.request.mockResolvedValue({ data: [{ id: 'speech', voices: [{ id: 'coral', label: 'Coral' }], defaultVoice: 'coral', responseFormat: 'wav', supportsInstructions: false, supportsSpeed: false, maxInputCharacters: 4096, maxInputTokens: null }] })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
})
describe('native speech lifecycle', () => {
  it('previews uploaded samples without generating speech and stops on background', async () => {
    const run = previewSpeechModel('speech'); await tick()
    expect(fetch).toHaveBeenCalledWith('https://instance.example/api/speech-models/speech/preview', expect.objectContaining({ headers: { authorization: 'Bearer session' } }))
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.play).toHaveBeenCalledOnce()
    mocks.onAppState?.('background'); await run
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.deleteFile).toHaveBeenCalledOnce()
  })
  it('plays with the session token and releases the player and temporary file on completion', async () => {
    const run = readAloud('chat:message', 'Hello')
    await tick(); expect(mocks.play).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://instance.example/api/speech', expect.objectContaining({ headers: { authorization: 'Bearer session', 'content-type': 'application/json' } }))
    expect(mocks.audioMode).toHaveBeenCalledWith(expect.objectContaining({ shouldPlayInBackground: false, allowsRecording: false }))
    mocks.status?.({ didJustFinish: true }); await run
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.deleteFile).toHaveBeenCalledOnce()
  })
  it('stops immediately on background and account changes', async () => {
    const run = readAloud('chat:message', 'Hello'); await tick()
    mocks.onAppState?.('background'); await run
    expect(speechPlayback.getSnapshot().phase).toBe('idle'); expect(mocks.pause).toHaveBeenCalled(); expect(mocks.deleteFile).toHaveBeenCalledOnce()
    const second = readAloud('chat:message', 'Hello'); await tick()
    mocks.onSession?.({ user: { id: 'new' }, instanceUrl: 'new', token: 'new' }, { user: { id: 'old' }, instanceUrl: 'old', token: 'old' }); await second
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2)
  })
  it('never falls back to a different provider when the model is removed', async () => {
    mocks.request.mockResolvedValue({ data: [] })
    await readAloud('chat:message', 'Hello')
    expect(fetch).not.toHaveBeenCalled(); expect(speechPlayback.getSnapshot().error).toContain('unavailable')
  })
  it('rejects playback while backgrounded', async () => {
    mocks.appState = 'background'; await readAloud('chat:message', 'Hello')
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.play).not.toHaveBeenCalled()
  })
})
