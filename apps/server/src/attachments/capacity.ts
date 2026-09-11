import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../lib/errors.js'

/** Refuse excess work instead of keeping an unbounded queue of request bodies. */
export function withAttachmentCapacity(
  capacity: number,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  let active = 0
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (active >= capacity) {
      reply.header('retry-after', '2')
      throw new AppError(503, 'attachment_busy', 'Attachment processing is busy. Please retry shortly.', 'server_error')
    }
    active += 1
    try {
      return await handler(request, reply)
    } finally {
      active -= 1
    }
  }
}

export const attachmentRateLimit = {
  rateLimit: {
    max: 1_200,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
  },
}
