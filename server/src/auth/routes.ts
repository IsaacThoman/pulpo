import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { loginInputSchema, signupInputSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, passwordCredentials, users } from '../database/schema.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  createPasswordHash,
  createSession,
  destroySession,
  requireUser,
  serializeUser,
  verifyPassword,
} from './service.js'

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    const input = loginInputSchema.parse(request.body)
    const [row] = await db
      .select({ user: users, credential: passwordCredentials })
      .from(users)
      .innerJoin(passwordCredentials, eq(users.id, passwordCredentials.userId))
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .limit(1)
    if (!row || row.user.blocked || !(await verifyPassword(row.credential.passwordHash, input.password))) {
      throw unauthorized('Invalid email or password')
    }
    await createSession(row.user.id, request, reply)
    return { user: serializeUser(row.user) }
  })

  app.post('/api/auth/signup', async (request, reply) => {
    const input = signupInputSchema.parse(request.body)
    const [setting] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
    const signupEnabled = (setting?.value as { signupEnabled?: boolean } | undefined)?.signupEnabled ?? true
    if (!signupEnabled) throw new AppError(403, 'signup_disabled', 'New signups are disabled')
    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${input.email})`).limit(1)
    if (existing) throw new AppError(409, 'email_taken', 'An account with this email already exists')
    const userId = newId()
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId, email: input.email, name: input.name, role: 'pending' })
      await tx.insert(passwordCredentials).values({ userId, passwordHash: await createPasswordHash(input.password) })
    })
    await createSession(userId, request, reply)
    const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    reply.code(201)
    return { user: serializeUser(created!) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(request, reply)
    reply.code(204).send()
  })

  app.get('/api/me', async (request) => ({ user: requireUser(request) }))
}
