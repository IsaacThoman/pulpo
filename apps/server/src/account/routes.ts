import { authenticateSessionToken, requestSessionToken } from '../auth/service.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { accountDeletionInputSchema } from '@pulpo/contracts'
import { AppError, unauthorized } from '../lib/errors.js'
import { hasTwoFactor } from '../auth/two-factor.js'
import { requireSensitiveAuth } from '../auth/sensitive-action.js'
import { getConfig } from '../config.js'
import { acceptAccountDeletion } from './deletion.js'

async function requireAccountSession(request: FastifyRequest): Promise<string> {
  if (!request.user || request.apiKeyId || request.managementTokenId || request.adminChatAccess) throw unauthorized()
  const session = await authenticateSessionToken(requestSessionToken(request))
  if (!session || session.id !== request.user.id) throw unauthorized()
  return request.user.id
}

export async function registerAccountDeletionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me/deletion', async (request) => {
    const userId = await requireAccountSession(request)
    return { twoFactorEnabled: await hasTwoFactor(userId) }
  })
  app.delete('/api/me', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const userId = await requireAccountSession(request)
    const input = accountDeletionInputSchema.parse(request.body)
    try {
      await requireSensitiveAuth(userId, input.currentPassword, input.verificationCode)
    } catch (error) {
      // A wrong confirmation password is not an expired session; clients must stay on the form.
      if (error instanceof AppError && error.statusCode === 401) throw new AppError(400, error.code === 'unauthorized' ? 'invalid_current_password' : error.code, error.message)
      throw error
    }
    await acceptAccountDeletion(userId)
    reply.clearCookie(getConfig().SESSION_COOKIE_NAME, { path: '/' })
    return reply.code(202).send({ status: 'deletion_requested' })
  })
}
