import {
  SIGNUP_PROMO_CLAIM_MS,
  signupPromoClaimSchema,
  signupPromoConfigSchema,
  type SignupPromoAdminSettings,
  type SignupPromoAvailability,
  type SignupPromoConfig,
  type SignupPromoReceipt,
} from '@pulpo/contracts'
import { and, eq, gte, lt, sql, sum } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin, requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, creditLedger, signupPromoClaims, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'

const SETTING_KEY = 'signupPromo'
const storedSettingsSchema = signupPromoConfigSchema.safeExtend({
  startedAt: z.iso.datetime().nullable(),
})
const defaultSettings: z.infer<typeof storedSettingsSchema> = {
  enabled: false, amountCents: 100, dailyCapCents: 2_000, message: '', startedAt: null,
}
type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

function readSettings(value: unknown) {
  const parsed = storedSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : defaultSettings
}

function eligible(user: Pick<typeof users.$inferSelect, 'signedUp' | 'role' | 'blocked' | 'deletionRequestedAt' | 'createdAt'> | undefined,
  settings: z.infer<typeof storedSettingsSchema>, now: Date): boolean {
  if (!settings.enabled || !settings.startedAt || !user?.signedUp || user.role === 'pending' || user.blocked || user.deletionRequestedAt) return false
  const created = user.createdAt.getTime()
  return created >= Date.parse(settings.startedAt) && created > now.getTime() - SIGNUP_PROMO_CLAIM_MS
}

async function databaseTime(database: Database): Promise<Date> {
  // Transaction time can be stale after waiting on the instance-wide claim lock.
  const [row] = await database.execute<{ now: number }>(sql`select (extract(epoch from clock_timestamp()) * 1000)::double precision as now`)
  return new Date(row!.now)
}

async function claimedToday(database: Database, now: Date): Promise<number> {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  const [row] = await database.select({ total: sum(signupPromoClaims.amountCents) }).from(signupPromoClaims)
    .where(and(gte(signupPromoClaims.claimedAt, start), lt(signupPromoClaims.claimedAt, end)))
  return Number(row?.total ?? 0)
}

async function adminSettings(database: Database, settings: SignupPromoConfig, now: Date): Promise<SignupPromoAdminSettings> {
  const { enabled, amountCents, dailyCapCents, message } = settings
  return { enabled, amountCents, dailyCapCents, message, claimedTodayCents: await claimedToday(database, now) }
}

export function registerSignupPromoRoutes(app: FastifyInstance): void {
  if (!getConfig().PULPO_BILLING_ENABLED) return

  app.get('/api/admin/billing/signup-promo', async (request) => {
    requireAdmin(request)
    const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, SETTING_KEY))
    return adminSettings(db, readSettings(row?.value), await databaseTime(db))
  })

  app.put('/api/admin/billing/signup-promo', async (request) => {
    const admin = requireAdmin(request)
    const input = signupPromoConfigSchema.parse(request.body)
    return db.transaction(async (tx) => {
      await tx.insert(applicationSettings).values({ key: SETTING_KEY, value: defaultSettings }).onConflictDoNothing()
      const [row] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, SETTING_KEY)).for('update')
      const previous = readSettings(row?.value)
      const now = await databaseTime(tx)
      const next = {
        ...input,
        startedAt: input.enabled ? previous.startedAt ?? now.toISOString() : null,
      }
      await tx.update(applicationSettings).set({ value: next, updatedAt: now, updatedBy: admin.id })
        .where(eq(applicationSettings.key, SETTING_KEY))
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'billing.signup_promo.update',
        targetType: 'application_settings', targetId: SETTING_KEY, metadata: { previous, next },
      })
      return adminSettings(tx, next, now)
    })
  })

  app.get('/api/billing/signup-promo', async (request, reply): Promise<SignupPromoAvailability> => {
    const { id: userId } = requireUser(request)
    reply.header('Cache-Control', 'no-store')
    const unavailable = { userId, offer: null }
    const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, SETTING_KEY))
    const settings = readSettings(row?.value)
    if (!settings.enabled) return unavailable

    const [account] = await db.select({
      user: users, claimId: signupPromoClaims.id,
    }).from(users).leftJoin(signupPromoClaims, eq(signupPromoClaims.userId, users.id)).where(eq(users.id, userId))
    const now = await databaseTime(db)
    if (account?.claimId || !eligible(account?.user, settings, now)) return unavailable
    if (await claimedToday(db, now) + settings.amountCents > settings.dailyCapCents) return unavailable
    return { userId, offer: { amountCents: settings.amountCents, message: settings.message } }
  })

  app.post('/api/billing/signup-promo/claim', async (request): Promise<SignupPromoReceipt> => {
    const { id: userId } = requireUser(request)
    const input = signupPromoClaimSchema.parse(request.body)
    if (input.userId !== userId) throw new AppError(409, 'signup_promo_account_changed', 'Your active account changed')

    const result = await db.transaction(async (tx) => {
      // Serialize claimers and settings edits before reading the day's spend.
      const [row] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, SETTING_KEY)).for('update')
      const [previous] = await tx.select({ amountCents: signupPromoClaims.amountCents })
        .from(signupPromoClaims).where(eq(signupPromoClaims.userId, userId))
      if (previous) return { receipt: previous }
      const settings = readSettings(row?.value)
      if (!settings.enabled) throw new AppError(409, 'signup_promo_unavailable', 'The signup promotion is unavailable')
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
      const now = await databaseTime(tx)
      if (!eligible(user, settings, now)) throw new AppError(409, 'signup_promo_unavailable', 'The signup promotion is unavailable')
      if (input.amountCents !== settings.amountCents) throw new AppError(409, 'signup_promo_changed', 'The signup credit amount changed')
      if (await claimedToday(tx, now) + settings.amountCents > settings.dailyCapCents) {
        throw new AppError(409, 'signup_promo_cap_reached', 'Today’s signup credits have all been claimed')
      }

      const amountMicros = settings.amountCents * 10_000
      const claimId = newId()
      await tx.insert(signupPromoClaims).values({ id: claimId, userId, amountCents: settings.amountCents, claimedAt: now })
      const [change] = await tx.update(users).set({
        balanceMicros: sql`${users.balanceMicros} + ${amountMicros}`,
        stateRevision: sql`${users.stateRevision} + 1`,
        updatedAt: now,
      }).where(eq(users.id, userId)).returning({ balance: users.balanceMicros, revision: users.stateRevision })
      await tx.insert(creditLedger).values({
        id: newId(), userId, type: 'signup_promo', amountMicros, balanceAfterMicros: change!.balance,
        createdAt: now, metadata: { claimId },
      })
      return { receipt: { amountCents: settings.amountCents }, revision: change!.revision }
    })

    if (result.revision !== undefined) {
      await publishStateChange({ userId, revision: result.revision, scopes: ['billing', 'usage'] }).catch((err) => {
        request.log.warn({ err }, 'Could not publish signup credit balance change')
      })
    }
    return result.receipt
  })
}
