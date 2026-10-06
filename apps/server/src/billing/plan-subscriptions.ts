import { and, eq, gt, inArray } from 'drizzle-orm'
import { db } from '../database/client.js'
import { appStoreSubscriptions, billingSubscriptions } from '../database/schema.js'
import type { SubscriptionPlanState } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type PlanSubscription = SubscriptionPlanState & { status: string; paidThrough: Date | null }

/** Every subscription that can grant a plan: Stripe subscriptions and App Store subscriptions. */
export async function loadPlanSubscriptions(executor: Transaction | typeof db, userId: string): Promise<PlanSubscription[]> {
  const [stripe, appStore] = await Promise.all([
    executor.select({
      plan: billingSubscriptions.plan,
      paidPlan: billingSubscriptions.paidPlan,
      status: billingSubscriptions.status,
      paidThrough: billingSubscriptions.paidThrough,
    }).from(billingSubscriptions).where(eq(billingSubscriptions.userId, userId)),
    executor.select({
      plan: appStoreSubscriptions.plan,
      paidPlan: appStoreSubscriptions.paidPlan,
      status: appStoreSubscriptions.status,
      paidThrough: appStoreSubscriptions.paidThrough,
    }).from(appStoreSubscriptions).where(eq(appStoreSubscriptions.userId, userId)),
  ])
  return [...stripe, ...appStore]
}

/** Whether the user has App Store plan access now, including a canceled plan still in its paid period. */
export async function hasActiveAppStoreSubscription(executor: Transaction | typeof db, userId: string, now = new Date()): Promise<boolean> {
  const [row] = await executor.select({ id: appStoreSubscriptions.originalTransactionId }).from(appStoreSubscriptions)
    .where(and(
      eq(appStoreSubscriptions.userId, userId),
      inArray(appStoreSubscriptions.status, ['active', 'past_due']),
      gt(appStoreSubscriptions.paidThrough, now),
    )).limit(1)
  return Boolean(row)
}
