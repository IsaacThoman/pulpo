import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAdminUsageRoutes } from './usage-routes.js'

const apps: ReturnType<typeof Fastify>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('admin usage leaderboard authorization', () => {
  it.each([
    '/api/admin/usage/leaderboard',
    '/api/admin/usage/leaderboard/activity',
    '/api/admin/usage/leaderboard/records',
  ])('rejects unauthenticated requests to %s', async (url) => {
    const app = Fastify()
    apps.push(app)
    await registerAdminUsageRoutes(app)

    const response = await app.inject({ method: 'GET', url })

    expect(response.statusCode).toBe(401)
  })
})
