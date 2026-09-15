import { SPEECH_DEFAULT_PREVIEW_TEXT, type SpeechPreferences } from '@pulpo/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  appState: 'active', onAppState: undefined as undefined | ((state: string) => void),
  onSession: undefined as undefined | ((state: unknown, previous: unknown) => void),
  status: undefined as undefined | ((status: { didJustFinish?: boolean; playbackState?: string }) => void),
  play: vi.fn(), pause: vi.fn(), remove: vi.fn(), deleteFile: vi.fn(), write: vi.fn(), audioMode: vi.fn(),
  preferences: { modelId: 'speech', models: {} } as SpeechPreferences, request: vi.fn(),
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
import { speechPlayback, readAloud, previewSpeech } from './playback'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
beforeEach(() => {
  mocks.preferences = { modelId: 'speech', models: {} }
  speechPlayback.stop(); vi.clearAllMocks(); mocks.appState = 'active'
  mocks.request.mockResolvedValue({ data: [{ id: 'speech', voices: [{ id: 'coral', label: 'Coral' }], defaultVoice: 'coral', responseFormat: 'wav', supportsInstructions: false, supportsSpeed: false, maxInputCharacters: 4096, maxInputTokens: null }] })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
})
describe('native speech lifecycle', () => {
  it('generates previews through normal speech requests and stops on background', async () => {
    const run = previewSpeech(); await tick()
    expect(fetch).toHaveBeenCalledWith('https://instance.example/api/speech', expect.objectContaining({ method: 'POST', headers: { authorization: 'Bearer session', 'content-type': 'application/json' } }))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ input: SPEECH_DEFAULT_PREVIEW_TEXT, voice: 'coral' })
    expect(mocks.play).toHaveBeenCalledOnce()
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
  it('carries generated duration into the prefetched watermark offset', async () => {
    mocks.request.mockResolvedValue({ data: [{ id: 'speech', voices: [{ id: 'coral', label: 'Coral' }], defaultVoice: 'coral', supportsInstructions: false, supportsSpeed: false, maxInputCharacters: 6, maxInputTokens: null }] })
    vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'x-speech-duration-seconds': '2.75' } }))
    const run = readAloud('chat:message', 'Hello world again')
    await tick(); await tick()
    expect(vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)).playbackOffsetSeconds)).toEqual([0, 2.75])
    speechPlayback.stop(); await run
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2)
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

it('uses current admin defaults without saving them as user preferences', async () => {
  mocks.preferences.modelId = null
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, defaultModelId: 'speech' })
  const run = readAloud('default', 'Hello')
  await tick(); await tick()
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: expect.any(String) }))
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ modelId: 'speech', voice: 'coral' })
  expect(mocks.preferences).toEqual({ modelId: null, models: {} })
  speechPlayback.stop(); await run
})
it('preserves explicit model and voice choices over admin defaults', async () => {
  mocks.preferences.models['speech'] = { voice: 'custom', instructions: '', speed: 1 }
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, defaultModelId: 'another-model' })
  const run = readAloud('explicit', 'Hello')
  await tick(); await tick()
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ modelId: 'speech', voice: 'custom' })
  speechPlayback.stop(); await run
})
it('does not replace an unavailable explicit choice with the admin default', async () => {
  mocks.preferences.modelId = 'removed'
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, defaultModelId: 'speech' })
  await readAloud('removed', 'Hello')
  expect(fetch).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().error).toContain('unavailable')
})
it('asks for a model when neither user nor admin has chosen one', async () => {
  mocks.preferences.modelId = null
  await readAloud('missing', 'Hello')
  expect(fetch).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().error).toContain('Choose a speech model')
})

it('previews the selected voice as plain text with all supported current settings', async () => {
  mocks.preferences.models['speech'] = { voice: 'custom', instructions: 'Speak warmly', speed: 1.4 }
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, data: [{ ...catalog.data[0], maxInputCharacters: 4096, supportsInstructions: true, supportsSpeed: true,
    voices: [{ id: 'custom', label: 'Custom', previewText: '**Hello** https://example.test' }, { id: 'coral', label: 'Coral', previewText: 'Other voice' }] }] })
  const run = previewSpeech()
  await tick(); await tick()
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ modelId: 'speech', voice: 'custom', instructions: 'Speak warmly', speed: 1.4, input: '**Hello** https://example.test', playbackOffsetSeconds: 0 })
  speechPlayback.stop(); await run
})
it.each([undefined, null])('uses the default preview text for an unset override (%s) and omits unsupported controls', async previewText => {
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, data: [{ ...catalog.data[0], maxInputCharacters: 4096, voices: [{ id: catalog.data[0].defaultVoice, label: 'Default', previewText }] }] })
  const run = previewSpeech()
  await tick(); await tick()
  const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))
  expect(request.input).toBe(SPEECH_DEFAULT_PREVIEW_TEXT)
  expect(request).not.toHaveProperty('instructions'); expect(request).not.toHaveProperty('speed')
  speechPlayback.stop(); await run
})
it('snapshots preferences while waiting for the latest catalog and generates again on each click', async () => {
  const catalog = await mocks.request()
  catalog.data[0].maxInputCharacters = 4096
  catalog.data[0].supportsInstructions = true; catalog.data[0].supportsSpeed = true
  mocks.preferences.models['speech'] = { voice: catalog.data[0].defaultVoice, instructions: 'Original', speed: 1.1 }
  let resolve!: (catalog: unknown) => void
  mocks.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const first = previewSpeech()
  mocks.preferences.models['speech']!.speed = 1.8
  resolve(catalog)
  await tick(); await tick()
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).speed).toBe(1.1)
  await previewSpeech(); await first
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  mocks.request.mockResolvedValue({ ...catalog, data: [{ ...catalog.data[0], voices: [{ id: catalog.data[0].defaultVoice, label: 'Default', previewText: 'Updated text' }] }] })
  const second = previewSpeech()
  await tick(); await tick()
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toMatchObject({ input: 'Updated text', speed: 1.8 })
  speechPlayback.stop(); await second
})
it('does not generate a preview for a removed voice', async () => {
  mocks.preferences.models['speech'] = { voice: 'removed', instructions: '', speed: 1 }
  await previewSpeech()
  expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().error).toContain('voice is unavailable')
})
it('cancels a preview while the catalog is loading without generating or playing', async () => {
  const catalog = await mocks.request()
  let resolve!: (catalog: unknown) => void
  mocks.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const run = previewSpeech()
  expect(speechPlayback.getSnapshot().phase).toBe('loading')
  await previewSpeech()
  resolve(catalog); await run
  expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
})
