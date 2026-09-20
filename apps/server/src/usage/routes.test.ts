import Fastify, { type FastifyRequest } from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: { select: mocks.select } }))
import { loadUsageActivity, registerUsageRoutes } from './routes.js'
import { decodeUsageCursor } from './public.js'

afterEach(() => vi.resetAllMocks())

function result(rows: unknown[]) {
  const query = {
    from: () => query, innerJoin: () => query, leftJoin: () => query,
    where: () => query, groupBy: () => query, orderBy: () => query, limit: () => query,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  }
  return query
}

const owner = { modelId: 'glm-5.3-flash', modelName: 'GLM-5.3 Flash', modelLogo: 'zhipu', modelVisible: true }
const target = { modelId: 'glm-5.3-flash-fireworks', modelName: 'GLM-5.3 Flash Fireworks', modelLogo: null, modelVisible: false }
const codex = { modelId: 'codex:gpt-5.6-sol', modelName: 'GPT-5.6 Sol', modelLogo: 'openai', modelVisible: true }
const redirects = [{ ownerModelId: owner.modelId, action: { modelId: target.modelId } }]

it('combines redirected usage and includes chart names beyond the top-ten ranking', async () => {
  const extra = Array.from({ length: 10 }, (_, index) => ({ modelId: `extra-${index}`, modelName: `Model ${index}`, modelLogo: null, modelVisible: true }))
  const usage = [owner, target, codex, ...extra].map((model) => ({
    ...model, calls: 1, inputTokens: 100, cacheWriteTokens: 5, outputTokens: 50, costMicros: 200,
  }))
  for (const rows of [[], usage.map((row) => ({ ...row, day: '2026-09-20' })), [], usage, [owner, target, codex, ...extra], redirects]) {
    mocks.select.mockReturnValueOnce(result(rows))
  }
  const activity = await loadUsageActivity({ userIds: ['me'], since: null, timeZone: 'UTC', hidePrivateModels: false })
  expect(activity.topModels).toHaveLength(10)
  expect(activity.topModels[0]).toEqual({
    modelId: owner.modelId, name: owner.modelName, logo: owner.modelLogo,
    calls: 2, inputTokens: 200, cacheWriteTokens: 10, outputTokens: 100, costMicros: 400,
  })
  expect(activity.daily.find((row) => row.modelId === owner.modelId)).toMatchObject({ calls: 2, costMicros: 400 })
  expect(activity.daily.some((row) => row.modelId === target.modelId)).toBe(false)
  expect(activity.modelNames).toEqual(Object.fromEntries([owner, codex, ...extra].map((model) => [model.modelId, model.modelName])))
})

it('returns canonical names and logos on personal records without changing accounting or pagination', async () => {
  const rows = [target, codex, owner].map((model, index) => ({
    usage: {
      id: `00000000-0000-4000-8000-00000000000${index}`, modelId: model.modelId,
      createdAt: new Date('2026-09-20T00:00:00Z'), costMicros: 250, inferenceReferenceCostMicros: 300, weeklyCostMicros: 100,
    },
    balanceAfterMicros: 500,
    displayModelId: model.modelId, displayModelName: model.modelName, displayModelLogo: model.modelLogo, displayModelVisible: model.modelVisible,
  }))
  for (const data of [rows, [owner, target, codex], redirects]) mocks.select.mockReturnValueOnce(result(data))
  const app = Fastify()
  app.addHook('onRequest', async (request) => { request.user = { id: 'me' } as FastifyRequest['user'] })
  try {
    await registerUsageRoutes(app)
    const response = await app.inject('/api/usage/records?limit=2')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.data).toHaveLength(2)
    for (const [index, model] of [owner, codex].entries()) expect(body.data[index]).toMatchObject({
      modelId: model.modelId, model: { id: model.modelId, name: model.modelName, logo: model.modelLogo },
      costMicros: 250, inferenceReferenceCostMicros: 300, subscriptionCoveredMicros: 100, balanceAfterMicros: 500,
    })
    expect(decodeUsageCursor(body.nextCursor)).toEqual({ id: rows[1]!.usage.id, createdAt: rows[1]!.usage.createdAt })
  } finally {
    await app.close()
  }
})
