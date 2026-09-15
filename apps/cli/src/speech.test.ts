import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OPENAI_SPEECH_PRESET, speechModelSchema } from '@pulpo/contracts'
import { createProgram } from './index.js'

let directory: string
const model = speechModelSchema.parse({ ...OPENAI_SPEECH_PRESET, id: 'tts', providerConnectionId: '11111111-1111-4111-8111-111111111111' })
const request = vi.fn()
const upload = vi.fn()
const download = vi.fn()
const info = vi.fn()
async function run(args: string[]) {
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', chunk => { output += chunk.toString() })
  const program = createProgram({ stdin: new PassThrough() as never, stdout, stderr: new PassThrough() }, {
    createClient: () => ({ info, request, upload, download }) as never,
  })
  await program.parseAsync(['node', 'pulpo', '--json', ...args])
  return output.trim() ? JSON.parse(output) : undefined
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pulpo-speech-cli-test-'))
  vi.stubEnv('PULPO_URL', 'https://pulpo.example.test')
  vi.stubEnv('PULPO_TOKEN', 'test-token')
  vi.clearAllMocks()
  info.mockResolvedValue({ managementApiVersion: 1, capabilities: ['speechModels'] })
  request.mockResolvedValue({ data: [model] })
  upload.mockResolvedValue({})
  download.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/wav' })
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })
it('prints an editable preset without connecting to a server', async () => {
  expect(await run(['speech-model', 'preset', 'tts', '--provider', model.providerConnectionId])).toEqual(model)
  expect(info).not.toHaveBeenCalled()
})
it('lists, reads, creates, updates, and deletes full model configurations', async () => {
  expect(await run(['speech-model', 'list'])).toEqual([model])
  expect(await run(['speech-model', 'get', 'tts'])).toEqual(model)
  const file = join(directory, 'model.json')
  for (const billingUnit of ['tokens', 'characters', 'duration'] as const) {
    const desired = { ...model, voices: model.voices.map((voice, index) => ({ ...voice, previewText: index === 0 ? 'Custom preview' : null })), enabled: true, maxInputCharacters: 100_000, maxInputTokens: 64_000, billingUnit, billUsers: true, inputPriceMicros: 12, outputPriceMicros: 34, characterPriceMicros: 56, minutePriceMicros: 78, sortOrder: 3 }
    await writeFile(file, JSON.stringify(desired))
    await run(['speech-model', 'create', '--file', file])
    expect(request).toHaveBeenLastCalledWith('/api/management/v1/speech-models', { method: 'POST', body: desired })
    await run(['speech-model', 'update', 'tts', '--file', file])
    expect(request).toHaveBeenLastCalledWith('/api/management/v1/speech-models/tts', { method: 'PATCH', body: desired })
  }
  await expect(run(['speech-model', 'delete', 'tts'])).rejects.toThrow('--yes')
  expect(await run(['--yes', 'speech-model', 'delete', 'tts'])).toEqual({ id: 'tts', deleted: true })
  expect(request).toHaveBeenLastCalledWith('/api/management/v1/speech-models/tts', { method: 'DELETE' })
})
it('rejects invalid model capabilities before connecting', async () => {
  const file = join(directory, 'invalid.json')
  await writeFile(file, JSON.stringify({ ...model, defaultVoice: 'missing' }))
  await expect(run(['speech-model', 'create', '-f', file])).rejects.toThrow('Default voice')
  expect(info).not.toHaveBeenCalled()
})
it('rejects retired preview commands and save options before connecting', async () => {
  await expect(run(['speech-model', 'preview', 'upload', 'tts', 'coral', 'file.wav'])).rejects.toThrow()
  await expect(run(['speech-model', 'test-voice', 'tts', 'coral', '-o', 'file.wav', '--save-preview'])).rejects.toThrow()
  expect(info).not.toHaveBeenCalled()
})
it('reports older servers without speech management support', async () => {
  info.mockResolvedValue({ managementApiVersion: 1, capabilities: ['catalog'] })
  await expect(run(['speech-model', 'list'])).rejects.toThrow('speechModels')
  expect(request).not.toHaveBeenCalled()
})

it('prints the Voxtral draft preset and manages cloned voices and watermark assets', async () => {
  expect(await run(['speech-model', 'preset', 'voxtral', '--provider', model.providerConnectionId, '--adapter', 'mistral'])).toMatchObject({ adapter: 'mistral', voices: [], enabled: false, supportsSse: false })
  const file = join(directory, 'voice.m4a'); await writeFile(file, new Uint8Array([1, 2, 3]))
  await run(['speech-model', 'clone', 'upload', 'voxtral', 'voice', file])
  expect(upload).toHaveBeenLastCalledWith('/api/management/v1/speech-models/voxtral/voices/voice/clone', expect.objectContaining({ filename: 'voice.m4a', timeoutMs: 120_000 }))
  await run(['speech-model', 'clone', 'repair', 'voxtral', 'voice'])
  expect(request).toHaveBeenLastCalledWith('/api/management/v1/speech-models/voxtral/voices/voice/clone/repair', { method: 'POST', timeoutMs: 120_000 })
  await run(['speech-model', 'watermark', 'upload', 'voxtral', 'voice', file])
  expect(upload).toHaveBeenLastCalledWith('/api/management/v1/speech-models/voxtral/voices/voice/watermark', expect.anything())
  await run(['speech-model', 'test-voice', 'voxtral', 'voice', '-o', join(directory, 'preview.wav'), '--text', 'Hello'])
  expect(download).toHaveBeenLastCalledWith('/api/management/v1/speech-models/voxtral/voices/voice/test', 120_000, { method: 'POST', body: { input: 'Hello' } })
  expect(new Uint8Array(await readFile(join(directory, 'preview.wav')))).toEqual(new Uint8Array([1, 2, 3]))
  await run(['speech-model', 'test-voice', 'voxtral', 'voice', '-o', join(directory, 'default.wav')])
  expect(download).toHaveBeenLastCalledWith('/api/management/v1/speech-models/voxtral/voices/voice/test', 120_000, { method: 'POST', body: {} })
})
