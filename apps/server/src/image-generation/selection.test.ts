import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { META_MUSE_IMAGE_PRESET } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  preference: { enabled: true, modelId: null as string | null },
  defaultModelId: null as string | null, rows: [] as unknown[], where: vi.fn(), readDefaults: vi.fn(),
}))
vi.mock('../database/client.js', async () => {
  const { userPreferences } = await import('../database/schema.js')
  return { db: { select: () => {
    let table: unknown
    const rows = () => table === userPreferences ? [{ values: { imageGeneration: mocks.preference } }] : mocks.rows
    const chain = {
      from: (value: unknown) => { table = value; return chain }, innerJoin: () => chain,
      where: (value: unknown) => { mocks.where(value); return chain }, limit: async () => rows(),
      then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows()).then(resolve),
    }
    return chain
  } } }
})
vi.mock('./defaults.js', () => ({ registerImageDefaultsRoutes: vi.fn(), readImageDefaults: mocks.readDefaults }))
vi.mock('../auth/service.js', () => ({ requireUser: () => ({ id: 'user' }), requireAdmin: vi.fn() }))
import { imageModels } from '../database/schema.js'
import { selectedImageModel } from './service.js'
import { registerImageGenerationRoutes } from './routes.js'
const model = { ...META_MUSE_IMAGE_PRESET, id: 'muse', providerConnectionId: '11111111-1111-4111-8111-111111111111', enabled: true }
const row = { config: model, enabled: true, provider: { enabled: true, encryptedApiKey: 'secret' } }
beforeEach(() => {
  mocks.preference = { enabled: true, modelId: null }; mocks.defaultModelId = null; mocks.rows = [row]
  mocks.where.mockClear(); mocks.readDefaults.mockReset().mockImplementation(async () => ({ modelId: mocks.defaultModelId }))
})

it('uses the current admin default for opted-in users without a personal selection', async () => {
  expect(await selectedImageModel('user')).toBeNull()
  for (const modelId of ['muse', 'replacement']) {
    mocks.defaultModelId = modelId
    mocks.rows = [{ ...row, config: { ...model, id: modelId } }]
    expect((await selectedImageModel('user'))?.model.id).toBe(modelId)
    expect(mocks.where).toHaveBeenLastCalledWith(eq(imageModels.id, modelId))
  }
})
it('keeps image generation disabled until users opt in', async () => {
  mocks.preference.enabled = false; mocks.defaultModelId = 'muse'
  expect(await selectedImageModel('user')).toBeNull()
  expect(mocks.readDefaults).not.toHaveBeenCalled()
})
it('honors personal choices, including unavailable ones, instead of substituting defaults', async () => {
  mocks.preference.modelId = 'chosen'; mocks.defaultModelId = 'muse'
  mocks.rows = [{ ...row, config: { ...model, id: 'chosen' } }]
  expect((await selectedImageModel('user'))?.model.id).toBe('chosen')
  expect(mocks.where).toHaveBeenLastCalledWith(eq(imageModels.id, 'chosen'))
  mocks.rows = []
  expect(await selectedImageModel('user')).toBeNull()
  expect(mocks.readDefaults).not.toHaveBeenCalled()
})
it.each([
  [], [{ ...row, config: { ...model, enabled: false } }],
  [{ ...row, provider: { ...row.provider, enabled: false } }],
  [{ ...row, provider: { ...row.provider, encryptedApiKey: null } }],
].map((rows, index) => ({ rows, index })))('rejects an unavailable default at generation time ($index)', async ({ rows }) => {
  mocks.defaultModelId = 'muse'; mocks.rows = rows
  expect(await selectedImageModel('user')).toBeNull()
})
it('publishes only available defaults and retains catalog order and public fields', async () => {
  const app = Fastify(); await registerImageGenerationRoutes(app)
  expect((await app.inject('/api/image-models')).json().defaultModelId).toBeNull()
  mocks.defaultModelId = 'muse'
  mocks.rows = [{ ...row, config: { ...model, sortOrder: 1 } }, { ...row, config: { ...model, id: 'first' } }]
  const response = await app.inject('/api/image-models')
  expect(response.statusCode).toBe(200)
  expect(response.json().defaultModelId).toBe('muse')
  expect(response.json().data.map((entry: { id: string }) => entry.id)).toEqual(['first', 'muse'])
  expect(response.body).not.toMatch(/providerConnectionId|upstreamModelId|secret/)
  for (const rows of [[], [{ ...row, config: { ...model, enabled: false } }], [{ ...row, enabled: false }]]) {
    mocks.rows = rows
    const result = (await app.inject('/api/image-models')).json()
    expect(result).toEqual({ data: [], defaultModelId: null })
  }
  await app.close()
})
