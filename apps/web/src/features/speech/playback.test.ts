// @vitest-environment jsdom
import { SPEECH_DEFAULT_PREVIEW_TEXT, type SpeechPreferences } from '@pulpo/contracts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ preferences: { modelId: 'voxtral', models: {} } as SpeechPreferences, request: vi.fn(), audio: vi.fn(), preview: vi.fn(), pause: vi.fn(), revoke: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request, fetchApiBlobResponse: mocks.audio, fetchApiBlob: mocks.preview }))
vi.mock('@/stores/settings', () => ({ useSettings: { getState: () => ({ speech: mocks.preferences }) } }))
vi.mock('@/stores/auth', () => ({ useAuth: { subscribe: vi.fn() } }))
vi.mock('@/stores/chat', () => ({ useChat: { subscribe: vi.fn() } }))
import { readAloud, previewSpeech, speechPlayback } from './playback'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
beforeEach(() => {
  mocks.preferences = { modelId: 'voxtral', models: {} }
  vi.clearAllMocks()
  vi.stubGlobal('Audio', class { pause = mocks.pause; removeAttribute() {} load() {} play = async () => {}; onended = null; onerror = null })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: mocks.revoke })
  mocks.request.mockResolvedValue({ data: [{ id: 'voxtral', defaultVoice: 'clone', voices: [{ id: 'clone', label: 'Clone' }], maxInputCharacters: 6, maxInputTokens: null, supportsSpeed: false, supportsInstructions: false }] })
  mocks.audio.mockImplementation(async () => new Response(new Uint8Array([1, 2]), { headers: { 'x-speech-duration-seconds': '2.75' } }))
})
afterEach(() => { speechPlayback.stop(); vi.unstubAllGlobals() })
it('sends cumulative duration with one-chunk prefetch and stops all audio', async () => {
  const run = readAloud('message', 'Hello world again')
  await tick(); await tick()
  const requests = mocks.audio.mock.calls.map(call => JSON.parse(call[1].body))
  expect(requests.map(request => request.playbackOffsetSeconds)).toEqual([0, 2.75])
  expect(requests[0]).toMatchObject({ voice: 'clone', modelId: 'voxtral' })
  expect(requests[0]).not.toHaveProperty('speed'); expect(requests[0]).not.toHaveProperty('instructions')
  speechPlayback.stop(); await run
  expect(mocks.audio).toHaveBeenCalledTimes(2); expect(mocks.revoke).toHaveBeenCalledTimes(2)
})
it('keeps old servers playable when duration is absent', async () => {
  mocks.audio.mockImplementation(async () => new Response(new Uint8Array([1, 2])))
  const run = readAloud('message', 'Hello world again')
  await tick(); await tick()
  expect(mocks.audio.mock.calls.map(call => JSON.parse(call[1].body).playbackOffsetSeconds)).toEqual([0, 0])
  speechPlayback.stop(); await run
})

it('uses current admin defaults without saving them as user preferences', async () => {
  mocks.preferences.modelId = null
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, defaultModelId: 'voxtral' })
  const run = readAloud('default', 'Hello')
  await tick(); await tick()
  expect(mocks.audio).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: expect.any(String) }))
  expect(JSON.parse(String(vi.mocked(mocks.audio).mock.calls[0]![1]?.body))).toMatchObject({ modelId: 'voxtral', voice: 'clone' })
  expect(mocks.preferences).toEqual({ modelId: null, models: {} })
  speechPlayback.stop(); await run
})
it('preserves explicit model and voice choices over admin defaults', async () => {
  mocks.preferences.models['voxtral'] = { voice: 'custom', instructions: '', speed: 1 }
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, defaultModelId: 'another-model' })
  const run = readAloud('explicit', 'Hello')
  await tick(); await tick()
  expect(JSON.parse(String(vi.mocked(mocks.audio).mock.calls[0]![1]?.body))).toMatchObject({ modelId: 'voxtral', voice: 'custom' })
  speechPlayback.stop(); await run
})
it('does not replace an unavailable explicit choice with the admin default', async () => {
  mocks.preferences.modelId = 'removed'
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, defaultModelId: 'voxtral' })
  await readAloud('removed', 'Hello')
  expect(mocks.audio).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().error).toContain('unavailable')
})
it('asks for a model when neither user nor admin has chosen one', async () => {
  mocks.preferences.modelId = null
  await readAloud('missing', 'Hello')
  expect(mocks.audio).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().error).toContain('Choose a speech model')
})

it('previews the selected voice as plain text with all supported current settings', async () => {
  mocks.preferences.models['voxtral'] = { voice: 'custom', instructions: 'Speak warmly', speed: 1.4 }
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, data: [{ ...catalog.data[0], maxInputCharacters: 4096, supportsInstructions: true, supportsSpeed: true,
    voices: [{ id: 'custom', label: 'Custom', previewText: '**Hello** https://example.test' }, { id: 'coral', label: 'Coral', previewText: 'Other voice' }] }] })
  const run = previewSpeech()
  await tick(); await tick()
  expect(JSON.parse(String(mocks.audio.mock.calls[0]![1]?.body))).toMatchObject({ modelId: 'voxtral', voice: 'custom', instructions: 'Speak warmly', speed: 1.4, input: '**Hello** https://example.test', playbackOffsetSeconds: 0 })
  speechPlayback.stop(); await run
})
it.each([undefined, null])('uses the default preview text for an unset override (%s) and omits unsupported controls', async previewText => {
  const catalog = await mocks.request()
  mocks.request.mockResolvedValue({ ...catalog, data: [{ ...catalog.data[0], maxInputCharacters: 4096, voices: [{ id: catalog.data[0].defaultVoice, label: 'Default', previewText }] }] })
  const run = previewSpeech()
  await tick(); await tick()
  const request = JSON.parse(String(mocks.audio.mock.calls[0]![1]?.body))
  expect(request.input).toBe(SPEECH_DEFAULT_PREVIEW_TEXT)
  expect(request).not.toHaveProperty('instructions'); expect(request).not.toHaveProperty('speed')
  speechPlayback.stop(); await run
})
it('snapshots preferences while waiting for the latest catalog and generates again on each click', async () => {
  const catalog = await mocks.request()
  catalog.data[0].maxInputCharacters = 4096
  catalog.data[0].supportsInstructions = true; catalog.data[0].supportsSpeed = true
  mocks.preferences.models['voxtral'] = { voice: catalog.data[0].defaultVoice, instructions: 'Original', speed: 1.1 }
  let resolve!: (catalog: unknown) => void
  mocks.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const first = previewSpeech()
  mocks.preferences.models['voxtral']!.speed = 1.8
  resolve(catalog)
  await tick(); await tick()
  expect(JSON.parse(String(mocks.audio.mock.calls[0]![1]?.body)).speed).toBe(1.1)
  await previewSpeech(); await first
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
  mocks.request.mockResolvedValue({ ...catalog, data: [{ ...catalog.data[0], voices: [{ id: catalog.data[0].defaultVoice, label: 'Default', previewText: 'Updated text' }] }] })
  const second = previewSpeech()
  await tick(); await tick()
  expect(mocks.audio).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String(mocks.audio.mock.calls[1]![1]?.body))).toMatchObject({ input: 'Updated text', speed: 1.8 })
  speechPlayback.stop(); await second
})
it('does not generate a preview for a removed voice', async () => {
  mocks.preferences.models['voxtral'] = { voice: 'removed', instructions: '', speed: 1 }
  await previewSpeech()
  expect(mocks.audio).not.toHaveBeenCalled()
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
  expect(mocks.audio).not.toHaveBeenCalled()
  expect(speechPlayback.getSnapshot().phase).toBe('idle')
})
