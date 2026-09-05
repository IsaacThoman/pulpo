import { registerAccountDeletionRoutes } from './account/routes.js'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'
import { getConfig, isAllowedOrigin, isAllowedRequestOrigin } from './config.js'
import { AppError } from './lib/errors.js'
import { authenticateSession } from './auth/service.js'
import { registerAuthRoutes } from './auth/routes.js'
import { registerCatalogRoutes } from './catalog/routes.js'
import { registerChatRoutes } from './chats/routes.js'
import { registerApiKeyRoutes } from './api-keys/routes.js'
import { registerPublicApiRoutes } from './public-api/routes.js'
import { registerSettingsRoutes } from './settings/routes.js'
import { registerShareRoutes } from './shares/routes.js'
import { registerUsageRoutes } from './usage/routes.js'
import { registerAdminRoutes } from './admin/routes.js'
import { registerAdminSettingsRoutes } from './admin/settings-routes.js'
import { registerAdminUsageRoutes } from './admin/usage-routes.js'
import { registerAdminChatAccess } from './admin/chat-access.js'
import { registerMessageRoutes } from './messages/routes.js'
import { registerAttachmentRoutes } from './attachments/routes.js'
import { ensureBuiltinCatalog } from './catalog/defaults.js'
import { registerMobileRoutes } from './mobile/routes.js'
import { registerResponseCompression } from './compression.js'
import { registerManagementRoutes } from './management/routes.js'
import { ensureBootstrapPreset } from './bootstrap/ci-preview.js'
import { registerCatalogIconRoutes } from './catalog/icon-routes.js'
import { registerFriendRoutes } from './friends/routes.js'
import { registerPoolRoutes } from './pools/routes.js'
import { registerProfileRoutes } from './profile/routes.js'
import { registerBillingRoutes } from './billing/routes.js'
import { registerAdminBillingRoutes } from './billing/admin-routes.js'
import { registerInviteCodeRoutes } from './invite-codes/routes.js'
import { registerDictationRoutes } from './dictation/routes.js'
import { registerCodexRoutes } from './codex/routes.js'

export async function buildApp() {
  const config = getConfig()
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
  })

  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const rawBody = typeof body === 'string' ? body : body.toString('utf8')
    request.rawBody = rawBody
    try {
      done(null, rawBody.length > 0 ? JSON.parse(rawBody) : null)
    } catch (error) {
      done(error as Error)
    }
  })

  await registerResponseCompression(app)
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cookie)
  await app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin, config)),
    credentials: true,
  })
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 * 1024, files: 1 } })

  app.decorateRequest('user', null)
  app.decorateRequest('adminChatAccess', null)
  app.decorateRequest('apiKeyId', null)
  app.decorateRequest('managementTokenId', null)
  app.decorateRequest('managementScopes', null)
  app.decorateRequest('rawBody', null)

  app.addHook('onRequest', async (request) => {
    request.user = await authenticateSession(request)
  })

  app.addHook('preValidation', async (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return
    if (request.url.startsWith('/v1/')) return
    const hasSession = Boolean(request.cookies[config.SESSION_COOKIE_NAME])
    if (!hasSession) return
    const origin = request.headers.origin
    if (origin && !isAllowedRequestOrigin(origin, request.headers.host, config)) {
      throw new AppError(403, 'origin_mismatch', 'Request origin is not allowed', 'permission_error')
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0]
      return reply.code(400).send({ error: {
        message: issue?.message ?? 'Invalid request',
        type: 'invalid_request_error',
        code: 'validation_error',
        param: issue?.path.join('.') || null,
      } })
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: {
        message: error.message,
        type: error.type,
        code: error.code,
        param: error.param,
      } })
    }
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413) {
      const chatImport = request.url.startsWith('/api/chats/import')
      return reply.code(413).send({ error: {
        message: chatImport ? 'Import file is too large' : 'Request body is too large',
        type: 'invalid_request_error',
        code: chatImport ? 'import_too_large' : 'payload_too_large',
        param: null,
      } })
    }
    request.log.error({ err: error }, 'Unhandled request error')
    return reply.code(500).send({ error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error',
      param: null,
    } })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'pulpo-api' }))
  await ensureBuiltinCatalog()
  await ensureBootstrapPreset()
  await registerMobileRoutes(app)
  await registerAuthRoutes(app)
  await registerAccountDeletionRoutes(app)
  await registerProfileRoutes(app)
  await registerCodexRoutes(app)
  await registerFriendRoutes(app)
  await registerPoolRoutes(app)
  await registerInviteCodeRoutes(app)
  await registerCatalogRoutes(app)
  await registerCatalogIconRoutes(app)
  await registerAdminChatAccess(app)
  await registerChatRoutes(app)
  await registerApiKeyRoutes(app)
  await registerSettingsRoutes(app)
  await registerShareRoutes(app)
  await registerUsageRoutes(app)
  await registerAdminRoutes(app)
  await registerAdminSettingsRoutes(app)
  await registerAdminUsageRoutes(app)
  await registerAdminBillingRoutes(app)
  await registerBillingRoutes(app)
  await registerMessageRoutes(app)
  await registerAttachmentRoutes(app)
  await registerDictationRoutes(app)
  await registerPublicApiRoutes(app)
  await registerManagementRoutes(app)

  return app
}
