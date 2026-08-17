import { and, eq, gt, isNull } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { managementScopeSchema, type ManagementScope } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { managementTokens, users } from '../database/schema.js'
import { hashToken, safeEqual } from '../lib/crypto.js'
import { forbidden, unauthorized } from '../lib/errors.js'
import { requireAdmin, requireUser, serializeUser } from '../auth/service.js'

declare module 'fastify' {
  interface FastifyRequest {
    managementTokenId: string | null
    managementScopes: ManagementScope[] | null
  }
}

function bearerManagementToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined
  return /^Bearer (mt-pulpo-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{32,})$/.exec(authorization)?.[1]
}

export async function authenticateManagementToken(request: FastifyRequest): Promise<void> {
  if (request.user) return
  const secret = bearerManagementToken(request.headers.authorization)
  if (!secret) return
  const prefix = secret.split('.', 1)[0]!
  const [row] = await db.select({ token: managementTokens, user: users })
    .from(managementTokens)
    .innerJoin(users, eq(managementTokens.userId, users.id))
    .where(and(
      eq(managementTokens.prefix, prefix),
      isNull(managementTokens.revokedAt),
      gt(managementTokens.expiresAt, new Date()),
    ))
    .limit(1)
  if (!row || row.user.blocked || !safeEqual(row.token.secretHash, hashToken(secret))) throw unauthorized('Invalid management token')
  const scopes = managementScopeSchema.array().parse(row.token.scopes)
  request.user = serializeUser(row.user)
  request.managementTokenId = row.token.id
  request.managementScopes = scopes
  await db.update(managementTokens).set({ lastUsedAt: new Date() }).where(eq(managementTokens.id, row.token.id))
}

export function requireManagementScope(
  request: FastifyRequest,
  scope: ManagementScope,
  options: { admin?: boolean } = {},
) {
  const user = options.admin ? requireAdmin(request) : requireUser(request)
  if (request.managementTokenId && !request.managementScopes?.includes(scope)) {
    throw forbidden(`Management token lacks the ${scope} scope`)
  }
  return user
}

export function requireInteractiveSession(request: FastifyRequest) {
  if (request.managementTokenId) throw forbidden('Management tokens cannot create or manage other management tokens')
  return requireUser(request)
}

export function requireInteractiveAdmin(request: FastifyRequest) {
  if (request.managementTokenId) throw forbidden('An interactive administrator session is required')
  return requireAdmin(request)
}
