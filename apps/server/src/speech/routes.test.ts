import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENAI_SPEECH_PRESET, speechModelSchema } from '@pulpo/contracts'
import { speechChunks } from '@pulpo/client-core'
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], claims: [] as unknown[], admin: true, user: true, generate: vi.fn(), charge: vi.fn() }))
vi.mock('../database/client.js', () => {
  const query = () => { const chain: Record<string, unknown> = {}; for (const name of ['from', 'innerJoin', 'where']) chain[name] = () => chain; chain.limit = async () => mocks.rows; chain.then = (resolve: (value: unknown[]) => void) => Promise.resolve(mocks.rows).then(resolve); return chain }
  return { db: { select: query, insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => mocks.claims.splice(0) }) }) }) } }
})
vi.mock('../auth/service.js', () => ({ requireUser: () => { if (!mocks.user) throw new Error('unauthorized'); return { id: 'u' } }, requireAdmin: () => { if (!mocks.admin) throw new Error('forbidden'); return { id: 'a' } } }))
vi.mock('../lib/url-security.js', () => ({ assertSafeProviderUrl: vi.fn() }))
vi.mock('../lib/crypto.js', () => ({ decryptSecret: () => 'secret' }))
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'key' }) }))
vi.mock('../accounting/service.js', () => ({ chargeMeteredUsage: mocks.charge }))
vi.mock('./provider.js', async importOriginal => ({ ...await importOriginal<typeof import('./provider.js')>(), generateSpeech: mocks.generate }))
import { publicSpeechModel, registerSpeechRoutes, validateSpeechInput } from './routes.js'
const model = speechModelSchema.parse({ ...OPENAI_SPEECH_PRESET, id: 'speech', providerConnectionId: '11111111-1111-4111-8111-111111111111', enabled: true, billUsers: true })
const request = { requestId: '22222222-2222-4222-8222-222222222222', modelId: 'speech', input: 'Hello', voice: 'coral', instructions: 'Calm', speed: 1 }
beforeEach(() => {
  mocks.rows = [{ config: model, enabled: true, voicePreviews: [{ voiceId: 'coral', objectKey: 'secret-storage-key' }], provider: { id: 'p', baseUrl: 'https://provider.example/v1', encryptedApiKey: 'encrypted-secret', enabled: true, requestTimeoutMs: 1000 } }]
  mocks.claims = [{}]; mocks.admin = true; mocks.user = true
  mocks.generate.mockReset().mockResolvedValue({ audio: Buffer.from('audio'), durationSeconds: 1, usage: { input_tokens: 10, output_tokens: 50 } })
  mocks.charge.mockReset().mockResolvedValue(undefined)
})
async function app() { const server = Fastify(); await registerSpeechRoutes(server); return server }
describe('speech routes', () => {
  it.each(['x', '👋', '\u0001'])('accepts every large client chunk of %s, including escaped JSON', async character => {
    const server = await app()
    const largerModel = speechModelSchema.parse({ ...model, maxInputCharacters: 100_000, maxInputTokens: null, billUsers: false })
    mocks.rows = [{ config: largerModel, provider: { baseUrl: 'https://provider.example/v1', encryptedApiKey: 'secret', enabled: true, requestTimeoutMs: 1000 } }]
    const instructions = '\u0001'.repeat(4096)
    const chunks = speechChunks(character.repeat(20_000), largerModel, instructions)
    for (const input of chunks) {
      mocks.claims = [{}]
      const response = await server.inject({ method: 'POST', url: '/api/speech', payload: { ...request, input, instructions } })
      expect(response.statusCode, response.body).toBe(200)
      expect(mocks.generate).toHaveBeenLastCalledWith(expect.objectContaining({ input: expect.objectContaining({ input }) }))
    }
    await server.close()
  })
  it('exposes only enabled public models and never provider credentials', async () => {
    const server = await app()
    const response = await server.inject('/api/speech-models')
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toMatch(/providerConnectionId|upstreamModelId|secret|baseUrl/)
    expect(response.json().data[0].id).toBe('speech')
    expect(response.json().data[0].voices.find((voice: { id: string }) => voice.id === 'coral').previewAvailable).toBe(true)
    mocks.rows = [{ config: { ...model, enabled: false }, enabled: true }, { config: model, enabled: false }]
    expect((await server.inject('/api/speech-models')).json().data).toEqual([])
    await server.close()
  })
  it('requires account and admin authentication', async () => {
    const server = await app(); mocks.user = false; mocks.admin = false
    for (const url of ['/api/speech-models', '/api/admin/speech-models']) expect((await server.inject(url)).statusCode).toBeGreaterThanOrEqual(400)
    expect((await server.inject({ method: 'POST', url: '/api/speech', payload: request })).statusCode).toBeGreaterThanOrEqual(400)
    expect(mocks.generate).not.toHaveBeenCalled(); await server.close()
  })
  it('settles a successful chunk once and rejects replay before generation', async () => {
    const server = await app()
    const first = await server.inject({ method: 'POST', url: '/api/speech', payload: request })
    expect(first.statusCode).toBe(200); expect(first.headers['cache-control']).toBe('no-store')
    expect(mocks.charge).toHaveBeenCalledWith(expect.objectContaining({ type: 'speech', costMicros: 606, metadata: expect.objectContaining({ requestId: request.requestId, inputTokens: 10, outputTokens: 50 }) }))
    expect(JSON.stringify(mocks.charge.mock.calls)).not.toMatch(/Hello|Calm|secret/)
    const duplicate = await server.inject({ method: 'POST', url: '/api/speech', payload: request })
    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400); expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.charge).toHaveBeenCalledOnce(); await server.close()
  })
  it('returns no audio when settlement fails, and never charges failed generation', async () => {
    const server = await app(); mocks.charge.mockRejectedValueOnce(new Error('Insufficient funds'))
    expect((await server.inject({ method: 'POST', url: '/api/speech', payload: request })).statusCode).toBeGreaterThanOrEqual(400)
    mocks.claims = [{}]; mocks.generate.mockRejectedValueOnce(new Error('upstream secret')); mocks.charge.mockClear()
    const response = await server.inject({ method: 'POST', url: '/api/speech', payload: request })
    expect(response.body).not.toContain('upstream secret'); expect(mocks.charge).not.toHaveBeenCalled(); await server.close()
  })
  it('rejects unavailable models and malicious payload overrides', async () => {
    const server = await app(); mocks.rows = []
    expect((await server.inject({ method: 'POST', url: '/api/speech', payload: request })).statusCode).toBeGreaterThanOrEqual(400)
    expect((await server.inject({ method: 'POST', url: '/api/speech', payload: { ...request, baseUrl: 'http://localhost' } })).statusCode).toBeGreaterThanOrEqual(400)
    expect(mocks.generate).not.toHaveBeenCalled(); await server.close()
  })
})
it('validates capabilities, voices, speed and input on the server', () => {
  expect(publicSpeechModel(model)).not.toHaveProperty('providerConnectionId')
  for (const input of [{ ...request, voice: 'missing' }, { ...request, speed: 5 }, { ...request, input: 'x'.repeat(4097) }, { ...request, input: '👋'.repeat(600) }]) expect(() => validateSpeechInput(model, input)).toThrow()
  expect(() => validateSpeechInput({ ...model, supportsInstructions: false }, request)).toThrow()
  expect(() => validateSpeechInput({ ...model, supportsSpeed: false }, request)).toThrow()
})
