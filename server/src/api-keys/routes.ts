import argon2 from 'argon2'
import { and, eq, gte, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createApiKeySchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { apiKeyModelPermissions, apiKeys, usageEvents, users } from '../database/schema.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { randomToken } from '../lib/crypto.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { requireUser, serializeUser } from '../auth/service.js'
import { createRedis } from '../redis.js'
import { getConfig } from '../config.js'

export async function authenticateApiKey(request: FastifyRequest, requiredScope: 'responses' | 'models') {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer sk-pulpo-')) throw unauthorized('Invalid API key')
  const secret = authorization.slice(7)
  const prefix = secret.split('.', 1)[0]
  const [row] = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(and(eq(apiKeys.prefix, prefix!), eq(apiKeys.status, 'active')))
    .limit(1)
  if (!row || row.user.blocked || !(await argon2.verify(row.key.secretHash, secret))) throw unauthorized('Invalid API key')
  const scopes = row.key.scopes as string[]
  if (!scopes.includes(requiredScope)) throw new AppError(403, 'scope_missing', `API key lacks the ${requiredScope} scope`, 'permission_error')
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id))
  request.apiKeyId = row.key.id
  request.user = serializeUser(row.user)
  return row.key
}

export async function assertApiKeyModelAllowed(apiKeyId: string, modelId: string): Promise<void> {
  const permissions = await db.select().from(apiKeyModelPermissions).where(eq(apiKeyModelPermissions.apiKeyId, apiKeyId))
  if (permissions.length > 0 && !permissions.some((permission) => permission.modelId === modelId)) {
    throw new AppError(403, 'model_not_allowed', 'This API key cannot use the selected model', 'permission_error')
  }
}

export async function registerApiKeyRoutes(app: FastifyInstance): Promise<void> {
  const redis = createRedis()
  app.addHook('onClose', async () => { await redis.quit() })
  app.get('/api/api-keys', async (request) => {
    const user = requireUser(request)
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id))
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    return { data: await Promise.all(rows.map(async ({ secretHash: _, ...row }) => {
      const allowedModels = await db.select({ modelId: apiKeyModelPermissions.modelId }).from(apiKeyModelPermissions).where(eq(apiKeyModelPermissions.apiKeyId, row.id))
      const [[lifetime], [monthly]] = await Promise.all([
        db.select({ total: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint` })
          .from(usageEvents).where(eq(usageEvents.apiKeyId, row.id)),
        db.select({ total: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint` })
          .from(usageEvents).where(and(eq(usageEvents.apiKeyId, row.id), gte(usageEvents.createdAt, monthStart))),
      ])
      return { ...row, allowedModels: allowedModels.map((item) => item.modelId), spentThisMonthMicros: Number(monthly?.total ?? 0), spentLifetimeMicros: Number(lifetime?.total ?? 0) }
    })) }
  })

  app.post('/api/api-keys', async (request, reply) => {
    const user = requireUser(request)
    const input = createApiKeySchema.parse(request.body)
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined
    const redisKey = idempotencyKey ? `pulpo:idempotency:api-key:${user.id}:${idempotencyKey}` : null
    if (redisKey) {
      const cached = await redis.get(redisKey)
      if (cached) {
        reply.code(201)
        return JSON.parse(decryptSecret(cached, getConfig().ENCRYPTION_KEY))
      }
    }
    const id = newId()
    const prefix = `sk-pulpo-${randomToken(6)}`
    const secret = `${prefix}.${randomToken(32)}`
    await db.transaction(async (tx) => {
      await tx.insert(apiKeys).values({
        id,
        userId: user.id,
        name: input.name,
        prefix,
        secretHash: await argon2.hash(secret, { type: argon2.argon2id }),
        scopes: input.scopes,
        monthlyBudgetMicros: input.monthlyBudgetMicros,
        lifetimeBudgetMicros: input.lifetimeBudgetMicros,
      })
      if (input.allowedModels.length > 0) {
        await tx.insert(apiKeyModelPermissions).values(input.allowedModels.map((modelId) => ({ apiKeyId: id, modelId })))
      }
    })
    const result = { id, prefix, secret }
    if (redisKey) await redis.set(redisKey, encryptSecret(JSON.stringify(result), getConfig().ENCRYPTION_KEY), 'EX', 86_400, 'NX')
    reply.code(201)
    return result
  })

  app.post('/api/api-keys/:id/revoke', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const result = await db
      .update(apiKeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
      .returning({ id: apiKeys.id })
    if (!result.length) throw new AppError(404, 'not_found', 'API key not found')
    return { id, revoked: true }
  })

  app.delete('/api/api-keys/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const deleted = await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id))).returning({ id: apiKeys.id })
    if (!deleted.length) throw new AppError(404, 'not_found', 'API key not found')
    reply.code(204).send()
  })
}
