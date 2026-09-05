import { authenticateSessionToken, requestSessionToken } from '../auth/service.js'
import type { FastifyInstance } from 'fastify'
import { accountDeletionInputSchema } from '@pulpo/contracts'
import { AppError, unauthorized } from '../lib/errors.js'
import { requireSensitiveAuth } from '../auth/sensitive-action.js'
import { getConfig } from '../config.js'
import { acceptAccountDeletion } from './deletion.js'

export async function registerAccountDeletionRoutes(app: FastifyInstance): Promise<void> {
  app.delete('/api/me', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    if (!request.user || request.apiKeyId || request.managementTokenId || request.adminChatAccess) throw unauthorized()
    const session = await authenticateSessionToken(requestSessionToken(request))
    if (!session || session.id !== request.user.id) throw unauthorized()
    const input = accountDeletionInputSchema.parse(request.body)
    try {
      await requireSensitiveAuth(request.user.id, input.currentPassword, input.verificationCode)
    } catch (error) {
      // A wrong confirmation password is not an expired session; clients must stay on the form.
      if (error instanceof AppError && error.statusCode === 401) throw new AppError(400, error.code === 'unauthorized' ? 'invalid_current_password' : error.code, error.message)
      throw error
    }
    await acceptAccountDeletion(request.user.id)
    reply.clearCookie(getConfig().SESSION_COOKIE_NAME, { path: '/' })
    return reply.code(202).send({ status: 'deletion_requested' })
  })
}
