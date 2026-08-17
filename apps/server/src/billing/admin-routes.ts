import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  auditEvents,
  billingAccounts,
  billingOrders,
  billingSubscriptions,
  billingWebhookEvents,
  users,
} from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import { parseBillingSettings } from '../settings/application-settings.js'
import { getBillingEntitlements } from './entitlements.js'

const settingsPatchSchema = z.object({
  eightWeeklyLimitMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fatWeeklyLimitMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

async function billingSettings() {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'billing')).limit(1)
  return parseBillingSettings(row?.value)
}

async function notifyBillingChange(userId: string): Promise<void> {
  const [change] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId)).returning({ userId: users.id, revision: users.stateRevision })
  if (change) await publishStateChange({ ...change, scopes: ['billing', 'usage'] })
}

export async function registerAdminBillingRoutes(app: FastifyInstance): Promise<void> {
  if (!getConfig().PULPO_BILLING_ENABLED) return

  app.get('/api/admin/billing/dashboard', async (request) => {
    requireAdmin(request)
    const { range } = z.object({ range: z.enum(['7d', '30d', '90d', 'all']).default('30d') }).parse(request.query)
    const days = range === 'all' ? null : Number.parseInt(range, 10)
    const start = days ? new Date(Date.now() - days * 86_400_000) : null
    const orderFilter = start ? gte(billingOrders.paidAt, start) : isNotNull(billingOrders.paidAt)
    const [totals, subscriberCounts, holds, failedEvents, recentOrders, recentSubscriptions, trend, settings] = await Promise.all([
      db.select({
        grossCollectedCents: sql<number>`coalesce(sum(${billingOrders.totalAmountCents}), 0)::bigint`,
        salesBeforeTaxCents: sql<number>`coalesce(sum(${billingOrders.netAmountCents}), 0)::bigint`,
        taxCollectedCents: sql<number>`coalesce(sum(${billingOrders.taxAmountCents}), 0)::bigint`,
        platformFeesCents: sql<number>`coalesce(sum(${billingOrders.platformFeeAmountCents}), 0)::bigint`,
        refundedCents: sql<number>`coalesce(sum(${billingOrders.refundedAmountCents}), 0)::bigint`,
        creditsGrantedMicros: sql<number>`coalesce(sum(${billingOrders.grantedCreditMicros}), 0)::bigint`,
        payments: sql<number>`count(*)::int`,
        topUps: sql<number>`count(*) filter (where ${billingOrders.billingReason} = 'purchase')::int`,
      }).from(billingOrders).where(orderFilter),
      db.select({
        plan: billingSubscriptions.plan,
        count: sql<number>`count(distinct ${billingSubscriptions.userId})::int`,
        canceling: sql<number>`count(distinct ${billingSubscriptions.userId}) filter (where ${billingSubscriptions.cancelAtPeriodEnd})::int`,
        pastDue: sql<number>`count(distinct ${billingSubscriptions.userId}) filter (where ${billingSubscriptions.status} = 'past_due')::int`,
      }).from(billingSubscriptions).where(and(
        inArray(billingSubscriptions.status, ['active', 'past_due']),
        gte(billingSubscriptions.paidThrough, new Date()),
      )).groupBy(billingSubscriptions.plan),
      db.select({ count: sql<number>`count(*)::int` }).from(billingAccounts)
        .where(and(isNotNull(billingAccounts.holdAt), isNull(billingAccounts.holdClearedAt))),
      db.select({ count: sql<number>`count(*)::int` }).from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.status, 'failed')),
      db.select().from(billingOrders).orderBy(desc(billingOrders.createdAt)).limit(20),
      db.select({ subscription: billingSubscriptions, userName: users.name, userEmail: users.email })
        .from(billingSubscriptions).innerJoin(users, eq(users.id, billingSubscriptions.userId))
        .orderBy(desc(billingSubscriptions.updatedAt)).limit(20),
      db.select({
        day: sql<string>`date_trunc('day', ${billingOrders.paidAt})::text`,
        totalCents: sql<number>`sum(${billingOrders.totalAmountCents})::bigint`,
        payments: sql<number>`count(*)::int`,
      }).from(billingOrders).where(orderFilter)
        .groupBy(sql`date_trunc('day', ${billingOrders.paidAt})`)
        .orderBy(sql`date_trunc('day', ${billingOrders.paidAt})`),
      billingSettings(),
    ])
    const eight = subscriberCounts.find((item) => item.plan === 'eight')
    const fat = subscriberCounts.find((item) => item.plan === 'fat')
    const orderTotals = totals[0]
    return {
      range,
      totals: {
        grossCollectedCents: Number(orderTotals?.grossCollectedCents ?? 0),
        salesBeforeTaxCents: Number(orderTotals?.salesBeforeTaxCents ?? 0),
        taxCollectedCents: Number(orderTotals?.taxCollectedCents ?? 0),
        platformFeesCents: Number(orderTotals?.platformFeesCents ?? 0),
        refundedCents: Number(orderTotals?.refundedCents ?? 0),
        creditsGrantedMicros: Number(orderTotals?.creditsGrantedMicros ?? 0),
        payments: Number(orderTotals?.payments ?? 0),
        topUps: Number(orderTotals?.topUps ?? 0),
        activeSubscribers: Number(eight?.count ?? 0) + Number(fat?.count ?? 0),
        monthlyRecurringCents: Number(eight?.count ?? 0) * 800 + Number(fat?.count ?? 0) * 2_400,
        canceling: Number(eight?.canceling ?? 0) + Number(fat?.canceling ?? 0),
        pastDue: Number(eight?.pastDue ?? 0) + Number(fat?.pastDue ?? 0),
        holds: Number(holds[0]?.count ?? 0),
        failedWebhooks: Number(failedEvents[0]?.count ?? 0),
      },
      subscribers: { eight: Number(eight?.count ?? 0), fat: Number(fat?.count ?? 0) },
      trend: trend.map((item) => ({ ...item, totalCents: Number(item.totalCents), payments: Number(item.payments) })),
      recentOrders,
      recentSubscriptions,
      reconciliation: {
        lastReconciledAt: settings.lastReconciledAt,
        lastError: settings.lastReconcileError,
      },
    }
  })

  app.get('/api/admin/billing/settings', async (request) => {
    requireAdmin(request)
    return billingSettings()
  })

  app.patch('/api/admin/billing/settings', async (request) => {
    const admin = requireAdmin(request)
    const patch = settingsPatchSchema.parse(request.body)
    const current = await billingSettings()
    const next = { ...current, ...patch }
    await db.transaction(async (tx) => {
      await tx.insert(applicationSettings).values({ key: 'billing', value: next, updatedBy: admin.id })
        .onConflictDoUpdate({
          target: applicationSettings.key,
          set: { value: next, updatedBy: admin.id, updatedAt: new Date() },
        })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'billing.defaults.update', targetType: 'billing', targetId: 'defaults',
        metadata: { previous: current, next: patch },
      })
    })
    return next
  })

  app.get('/api/admin/billing/users', async (request) => {
    requireAdmin(request)
    const rows = await db.select({ id: users.id }).from(users)
    const data = await Promise.all(rows.map(async ({ id }) => {
      const entitlements = await getBillingEntitlements(id)
      const [account] = await db.select({
        holdAt: billingAccounts.holdAt,
        holdReason: billingAccounts.holdReason,
        holdReference: billingAccounts.holdReference,
      }).from(billingAccounts).where(eq(billingAccounts.userId, id)).limit(1)
      return {
        userId: id,
        plan: entitlements.plan,
        weeklyLimitMicros: entitlements.weeklyLimitMicros,
        weeklySpentMicros: entitlements.weeklySpentMicros,
        weeklyRemainingMicros: Math.max(0, entitlements.weeklyLimitMicros - entitlements.weeklySpentMicros),
        weeklyLimitOverridden: entitlements.weeklyLimitOverridden,
        hold: entitlements.onHold ? account ?? null : null,
      }
    }))
    return { data }
  })

  app.patch('/api/admin/billing/users/:id/weekly-limit', async (request) => {
    const admin = requireAdmin(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { weeklyLimitMicros } = z.object({
      weeklyLimitMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    }).parse(request.body)
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
    if (!user) throw new AppError(404, 'user_not_found', 'User not found')
    await db.transaction(async (tx) => {
      await tx.insert(billingAccounts).values({ userId: id, weeklyLimitOverrideMicros: weeklyLimitMicros })
        .onConflictDoUpdate({
          target: billingAccounts.userId,
          set: { weeklyLimitOverrideMicros: weeklyLimitMicros, updatedAt: new Date() },
        })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id,
        action: weeklyLimitMicros === null ? 'billing.weekly_limit.reset' : 'billing.weekly_limit.update',
        targetType: 'user', targetId: id, metadata: { weeklyLimitMicros },
      })
    })
    await notifyBillingChange(id)
    return { weeklyLimitMicros }
  })

  app.post('/api/admin/billing/users/:id/clear-hold', async (request) => {
    const admin = requireAdmin(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { note } = z.object({ note: z.string().trim().min(1).max(1_000) }).parse(request.body)
    const [account] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, id)).limit(1)
    if (!account?.holdAt || account.holdClearedAt) throw new AppError(409, 'billing_hold_missing', 'This user is not on billing hold')
    await db.transaction(async (tx) => {
      await tx.update(billingAccounts).set({
        holdClearedAt: new Date(), holdClearedBy: admin.id, updatedAt: new Date(),
      }).where(eq(billingAccounts.userId, id))
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'billing.hold.clear', targetType: 'user', targetId: id,
        metadata: { note, reason: account.holdReason, reference: account.holdReference },
      })
    })
    await notifyBillingChange(id)
    return { cleared: true }
  })

  app.post('/api/admin/billing/reconcile', async (request, reply) => {
    requireAdmin(request)
    await maintenanceQueue.add('billing-reconcile', { type: 'billing-reconcile' }, {
      jobId: `billing-reconcile-manual-${Date.now()}`,
      attempts: 3,
      removeOnComplete: 20,
      removeOnFail: 100,
    })
    reply.code(202)
    return { queued: true }
  })
}
