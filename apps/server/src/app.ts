import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'
import { getConfig, isAllowedOrigin } from './config.js'
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
import { registerMessageRoutes } from './messages/routes.js'
import { registerAttachmentRoutes } from './attachments/routes.js'
import { ensureBuiltinCatalog } from './catalog/defaults.js'
import { registerMobileRoutes } from './mobile/routes.js'
import { registerResponseCompression } from './compression.js'
import { registerManagementRoutes } from './management/routes.js'
import { ensureBootstrapPreset } from './bootstrap/ci-preview.js'
import { registerCatalogIconRoutes } from './catalog/icon-routes.js'

export async function buildApp() {
  const config = getConfig()
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
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
  app.decorateRequest('apiKeyId', null)
  app.decorateRequest('managementTokenId', null)
  app.decorateRequest('managementScopes', null)

  app.addHook('onRequest', async (request) => {
    request.user = await authenticateSession(request)
  })

  app.addHook('preValidation', async (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return
    if (request.url.startsWith('/v1/')) return
    const hasSession = Boolean(request.cookies[config.SESSION_COOKIE_NAME])
    if (!hasSession) return
    const origin = request.headers.origin
    if (origin && !isAllowedOrigin(origin, config)) {
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
  await registerCatalogRoutes(app)
  await registerCatalogIconRoutes(app)
  await registerChatRoutes(app)
  await registerApiKeyRoutes(app)
  await registerSettingsRoutes(app)
  await registerShareRoutes(app)
  await registerUsageRoutes(app)
  await registerAdminRoutes(app)
  await registerAdminSettingsRoutes(app)
  await registerAdminUsageRoutes(app)
  await registerMessageRoutes(app)
  await registerAttachmentRoutes(app)
  await registerPublicApiRoutes(app)
  await registerManagementRoutes(app)

  return app
}
