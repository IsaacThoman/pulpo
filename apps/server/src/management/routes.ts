import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  createManagementTokenSchema,
  managementAccountSettingsDocumentSchema,
  managementInstanceSettingsDocumentSchema,
  managementSettingsDocumentSchema,
  nativeLoginInputSchema,
  type ManagementScope,
} from '@pulpo/contracts'
import { db } from '../database/client.js'
import { auditEvents, managementTokens, passwordCredentials, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { createNativeSession, destroyNativeSession, runWithAuthenticatedUser, serializeUser, verifyPassword } from '../auth/service.js'
import { requireLoginSecondFactor } from '../auth/two-factor.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError, notFound, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { createRedis } from '../redis.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { authenticateManagementToken, requireInteractiveSession, requireManagementScope } from './auth.js'
import { applyManagementSettings, loadManagementSettings, planManagementSettings } from './settings.js'

function serializeToken(row: typeof managementTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

const ADMIN_SCOPES = new Set<ManagementScope>([
  'instance:read', 'instance:write', 'catalog:read', 'catalog:write', 'users:read', 'users:write',
  'usage:read', 'audit:read', 'operations:read', 'operations:write',
])

async function proxyResponse(app: FastifyInstance, request: FastifyRequest, targetUrl: string) {
  const user = request.user
  if (!user) throw unauthorized()
  const response = await runWithAuthenticatedUser(user, async () => await app.inject({
    method: request.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: targetUrl,
    payload: request.body as object | string | Buffer | undefined,
    headers: {
      ...(request.headers['idempotency-key'] ? { 'idempotency-key': String(request.headers['idempotency-key']) } : {}),
      ...(request.headers['content-type'] ? { 'content-type': String(request.headers['content-type']) } : {}),
    },
  }))
  return response
}

function registerProxy(
  management: FastifyInstance,
  root: FastifyInstance,
  sourcePrefix: string,
  targetPrefix: string,
  readScope: ManagementScope,
  writeScope: ManagementScope,
) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const scope = request.method === 'GET' ? readScope : writeScope
    requireManagementScope(request, scope, { admin: true })
    const response = await proxyResponse(root, request, request.url.replace(sourcePrefix, targetPrefix))
    reply.code(response.statusCode)
    const contentType = response.headers['content-type']
    const disposition = response.headers['content-disposition']
    if (contentType) reply.header('content-type', contentType)
    if (disposition) reply.header('content-disposition', disposition)
    if (response.statusCode === 204) return reply.send()
    return reply.send(response.rawPayload)
  }
  management.all(sourcePrefix, handler)
  management.all(`${sourcePrefix}/*`, handler)
}

export async function registerManagementRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (management) => {
    management.addHook('preHandler', authenticateManagementToken)

    management.get('/api/management/v1/info', async () => {
      const config = getConfig()
      return {
        managementApiVersion: 1,
        instance: { name: config.INSTANCE_NAME, version: config.PULPO_VERSION, publicUrl: config.PUBLIC_URL },
        deployment: {
          storageDriver: config.STORAGE_DRIVER,
          databaseConfigured: Boolean(config.DATABASE_URL || (config.POSTGRES_HOST && config.POSTGRES_DATABASE)),
          redisConfigured: Boolean(config.REDIS_URL),
          s3Configured: config.STORAGE_DRIVER === 's3' && Boolean(config.S3_ENDPOINT && config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY),
          encryptionConfigured: Boolean(config.ENCRYPTION_KEY),
          cookieSecure: config.COOKIE_SECURE,
          smtpConfigured: Boolean(config.SMTP_URL),
          workspaceControllerConfigured: Boolean(config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN),
        },
        capabilities: [
          'settings', 'managementTokens', 'catalog', 'users', 'usage', 'audit', 'workspaces', 'banners', 'exports', 'backups', 'operations', 'twoFactor',
        ],
      }
    })

    management.post('/api/management/v1/auth/login', async (request) => {
      const input = nativeLoginInputSchema.parse(request.body)
      const [row] = await db.select({ user: users, credential: passwordCredentials })
        .from(users).innerJoin(passwordCredentials, eq(users.id, passwordCredentials.userId))
        .where(sql`lower(${users.email}) = lower(${input.email})`).limit(1)
      if (!row || row.user.blocked || !(await verifyPassword(row.credential.passwordHash, input.password))) {
        throw unauthorized('Invalid email or password')
      }
      await requireLoginSecondFactor(row.user.id, input.twoFactorCode)
      return { user: serializeUser(row.user), session: await createNativeSession(row.user.id, input.deviceLabel, request) }
    })

    management.post('/api/management/v1/auth/logout', async (request, reply) => {
      requireInteractiveSession(request)
      await destroyNativeSession(request)
      reply.code(204).send()
    })

    management.get('/api/management/v1/auth/me', async (request) => ({ user: requireManagementScope(request, 'account:read') }))

    management.get('/api/management/v1/tokens', async (request) => {
      const user = requireInteractiveSession(request)
      const rows = await db.select().from(managementTokens).where(eq(managementTokens.userId, user.id))
      return { data: rows.map(serializeToken) }
    })

    management.post('/api/management/v1/tokens', async (request, reply) => {
      const user = requireInteractiveSession(request)
      const input = createManagementTokenSchema.parse(request.body)
      if (input.scopes.some((scope) => ADMIN_SCOPES.has(scope)) && user.role !== 'admin') {
        throw new AppError(403, 'admin_scope_forbidden', 'Administrator access is required for instance management scopes', 'permission_error')
      }
      const id = newId()
      const prefix = `mt-pulpo-${randomToken(6)}`
      const secret = `${prefix}.${randomToken(32)}`
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000)
      const [created] = await db.insert(managementTokens).values({
        id, userId: user.id, name: input.name, prefix, secretHash: hashToken(secret), scopes: input.scopes, expiresAt,
      }).returning()
      await db.insert(auditEvents).values({
        id: newId(), actorUserId: user.id, action: 'management_token.create', targetType: 'management_token', targetId: id,
        metadata: { name: input.name, scopes: input.scopes, expiresAt: expiresAt.toISOString() },
      })
      reply.code(201)
      return { ...serializeToken(created!), secret }
    })

    management.post('/api/management/v1/tokens/:id/revoke', async (request) => {
      const user = requireInteractiveSession(request)
      const { id } = request.params as { id: string }
      const [revoked] = await db.update(managementTokens).set({ revokedAt: new Date() })
        .where(and(eq(managementTokens.id, id), eq(managementTokens.userId, user.id), isNull(managementTokens.revokedAt))).returning()
      if (!revoked) throw notFound('Management token')
      await db.insert(auditEvents).values({
        id: newId(), actorUserId: user.id, action: 'management_token.revoke', targetType: 'management_token', targetId: id,
      })
      return serializeToken(revoked)
    })

    management.get('/api/management/v1/settings', async (request) => {
      const user = requireManagementScope(request, 'account:read')
      requireManagementScope(request, 'instance:read', { admin: true })
      return loadManagementSettings(user.id)
    })

    management.get('/api/management/v1/settings/account', async (request) => {
      const user = requireManagementScope(request, 'account:read')
      const current = await loadManagementSettings(user.id)
      return managementAccountSettingsDocumentSchema.parse({
        apiVersion: current.apiVersion, kind: 'AccountSettings', revision: current.revision, account: current.account,
      })
    })

    management.get('/api/management/v1/settings/instance', async (request) => {
      const user = requireManagementScope(request, 'instance:read', { admin: true })
      const current = await loadManagementSettings(user.id)
      return managementInstanceSettingsDocumentSchema.parse({
        apiVersion: current.apiVersion, kind: 'InstanceSettings', revision: current.revision, instance: current.instance,
      })
    })

    management.post('/api/management/v1/settings/plan', async (request) => {
      const user = requireManagementScope(request, 'account:write')
      requireManagementScope(request, 'instance:write', { admin: true })
      const body = request.body as { document?: unknown; secrets?: { webToolsApiKey?: string | null } }
      return planManagementSettings(user.id, body.document, body.secrets)
    })

    management.post('/api/management/v1/settings/account/plan', async (request) => {
      const user = requireManagementScope(request, 'account:write')
      const body = request.body as { document?: unknown }
      const document = managementAccountSettingsDocumentSchema.parse(body.document)
      const current = await loadManagementSettings(user.id)
      const plan = await planManagementSettings(user.id, { ...current, revision: document.revision, account: document.account }, {}, 'account')
      return {
        revision: plan.revision,
        changes: plan.changes,
        document: { apiVersion: document.apiVersion, kind: document.kind, revision: plan.revision, account: plan.document.account },
      }
    })

    management.post('/api/management/v1/settings/instance/plan', async (request) => {
      const user = requireManagementScope(request, 'instance:write', { admin: true })
      const body = request.body as { document?: unknown; secrets?: { webToolsApiKey?: string | null } }
      const document = managementInstanceSettingsDocumentSchema.parse(body.document)
      const current = await loadManagementSettings(user.id)
      const plan = await planManagementSettings(user.id, { ...current, revision: document.revision, instance: document.instance }, body.secrets, 'instance')
      return {
        revision: plan.revision,
        changes: plan.changes,
        document: { apiVersion: document.apiVersion, kind: document.kind, revision: plan.revision, instance: plan.document.instance },
      }
    })

    management.post('/api/management/v1/settings/apply', async (request) => {
      const user = requireManagementScope(request, 'account:write')
      requireManagementScope(request, 'instance:write', { admin: true })
      const body = request.body as { document?: unknown; revision?: unknown; secrets?: { webToolsApiKey?: string | null } }
      if (typeof body.revision !== 'string') throw new AppError(400, 'revision_required', 'A planned settings revision is required')
      managementSettingsDocumentSchema.parse(body.document)
      return applyManagementSettings(user.id, user.id, body.document, body.revision, body.secrets)
    })

    management.post('/api/management/v1/settings/account/apply', async (request) => {
      const user = requireManagementScope(request, 'account:write')
      const body = request.body as { document?: unknown; revision?: unknown }
      if (typeof body.revision !== 'string') throw new AppError(400, 'revision_required', 'A planned settings revision is required')
      const document = managementAccountSettingsDocumentSchema.parse(body.document)
      const current = await loadManagementSettings(user.id)
      const applied = await applyManagementSettings(
        user.id, user.id, { ...current, revision: document.revision, account: document.account }, body.revision, {}, 'account',
      )
      return { apiVersion: document.apiVersion, kind: document.kind, revision: applied.revision, account: applied.account }
    })

    management.post('/api/management/v1/settings/instance/apply', async (request) => {
      const user = requireManagementScope(request, 'instance:write', { admin: true })
      const body = request.body as { document?: unknown; revision?: unknown; secrets?: { webToolsApiKey?: string | null } }
      if (typeof body.revision !== 'string') throw new AppError(400, 'revision_required', 'A planned settings revision is required')
      const document = managementInstanceSettingsDocumentSchema.parse(body.document)
      const current = await loadManagementSettings(user.id)
      const applied = await applyManagementSettings(
        user.id, user.id, { ...current, revision: document.revision, instance: document.instance }, body.revision, body.secrets, 'instance',
      )
      return { apiVersion: document.apiVersion, kind: document.kind, revision: applied.revision, instance: applied.instance }
    })

    management.get('/api/management/v1/status', async (request) => {
      requireManagementScope(request, 'instance:read', { admin: true })
      const redis = createRedis()
      let database = false
      let redisHealthy = false
      let redisTimeout: ReturnType<typeof setTimeout> | undefined
      try { await db.execute(sql`select 1`); database = true } catch { database = false }
      try {
        const pong = await Promise.race([
          redis.ping(),
          new Promise<never>((_resolve, reject) => {
            redisTimeout = setTimeout(() => reject(new Error('Redis health check timed out')), 5_000)
          }),
        ])
        redisHealthy = pong === 'PONG'
      } catch {
        redisHealthy = false
      } finally {
        if (redisTimeout) clearTimeout(redisTimeout)
        redis.disconnect()
      }
      const config = getConfig()
      let controller: { configured: boolean; healthy: boolean; detail?: string } = {
        configured: Boolean(config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN), healthy: false,
      }
      if (controller.configured) {
        try {
          const response = await workspaceControllerRequest('/healthz', { signal: AbortSignal.timeout(5_000) }, false)
          controller = { configured: true, healthy: response.ok, ...(response.ok ? {} : { detail: `Controller returned ${response.status}` }) }
        } catch (error) {
          request.log.warn({ err: error }, 'Management controller health check failed')
          controller = { configured: true, healthy: false, detail: 'Controller health check failed' }
        }
      }
      return { healthy: database && redisHealthy && (!controller.configured || controller.healthy), database, redis: redisHealthy, controller }
    })

    management.post('/api/management/v1/users/:id/reset-link', async (request, reply) => {
      requireManagementScope(request, 'users:write', { admin: true })
      const response = await proxyResponse(app, request, request.url.replace('/api/management/v1/users', '/api/admin/users'))
      if (response.statusCode !== 200) return reply.code(response.statusCode).send(response.rawPayload)
      const result = response.json() as { token: string; expiresAt: string }
      const publicUrl = getConfig().PUBLIC_URL.replace(/\/$/, '')
      return {
        url: `${publicUrl}/reset-password?token=${encodeURIComponent(result.token)}`,
        expiresAt: result.expiresAt,
      }
    })

    registerProxy(management, app, '/api/management/v1/providers', '/api/admin/providers', 'catalog:read', 'catalog:write')
    registerProxy(management, app, '/api/management/v1/labs', '/api/admin/labs', 'catalog:read', 'catalog:write')
    registerProxy(management, app, '/api/management/v1/models', '/api/admin/models', 'catalog:read', 'catalog:write')
    registerProxy(management, app, '/api/management/v1/users', '/api/admin/users', 'users:read', 'users:write')
    registerProxy(management, app, '/api/management/v1/usage', '/api/admin/usage', 'usage:read', 'usage:read')
    registerProxy(management, app, '/api/management/v1/audit-events', '/api/admin/audit-events', 'audit:read', 'audit:read')
    registerProxy(management, app, '/api/management/v1/workspaces', '/api/admin/usage/workspaces', 'operations:read', 'operations:write')
    registerProxy(management, app, '/api/management/v1/banners', '/api/admin/banners', 'operations:read', 'operations:write')
    registerProxy(management, app, '/api/management/v1/exports', '/api/admin/exports', 'operations:read', 'operations:write')
    registerProxy(management, app, '/api/management/v1/backups', '/api/admin/backups', 'operations:read', 'operations:write')
  })
}
