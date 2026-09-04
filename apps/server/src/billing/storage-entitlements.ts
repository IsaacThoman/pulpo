import { and, eq, ne } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings, billingAccounts, billingSubscriptions, users } from '../database/schema.js'
import { parseAuthSettings, parseBillingSettings, type BillingSettings } from '../settings/application-settings.js'
import { resolvePlanEntitlement, type BillingPlan } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface StorageEntitlement {
  storageLimitBytes: number
  storageLimitOverridden: boolean
}

export function storageDefaultForPlan(settings: BillingSettings, plan: BillingPlan): number {
  if (plan === 'fat') return settings.fatStorageLimitBytes
  if (plan === 'eight') return settings.eightStorageLimitBytes
  return settings.babyStorageLimitBytes
}

export function effectiveStorageLimit(settings: BillingSettings, plan: BillingPlan, override?: number | null): StorageEntitlement {
  return {
    storageLimitBytes: override ?? storageDefaultForPlan(settings, plan),
    storageLimitOverridden: override !== null && override !== undefined,
  }
}

export async function loadStorageEntitlement(
  tx: Transaction,
  userId: string,
  now = new Date(),
): Promise<StorageEntitlement> {
  if (!getConfig().PULPO_BILLING_ENABLED) {
    const [[setting], [account]] = await Promise.all([
      tx.select({ value: applicationSettings.value }).from(applicationSettings)
        .where(eq(applicationSettings.key, 'auth')).limit(1),
      tx.select({ storageLimitOverrideBytes: billingAccounts.storageLimitOverrideBytes }).from(billingAccounts)
        .where(eq(billingAccounts.userId, userId)).limit(1),
    ])
    const override = account?.storageLimitOverrideBytes
    return {
      storageLimitBytes: override ?? parseAuthSettings(setting?.value).defaultStorageLimitBytes,
      storageLimitOverridden: override !== null && override !== undefined,
    }
  }

  const [[account], subscriptions, [setting]] = await Promise.all([
    tx.select({
      storageLimitOverrideBytes: billingAccounts.storageLimitOverrideBytes,
      planOverride: billingAccounts.planOverride,
    }).from(billingAccounts)
      .where(eq(billingAccounts.userId, userId)).limit(1),
    tx.select({ plan: billingSubscriptions.plan, status: billingSubscriptions.status, paidThrough: billingSubscriptions.paidThrough })
      .from(billingSubscriptions).where(eq(billingSubscriptions.userId, userId)),
    tx.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'billing')).limit(1),
  ])
  return effectiveStorageLimit(
    parseBillingSettings(setting?.value),
    resolvePlanEntitlement(subscriptions, account?.planOverride, now).plan,
    account?.storageLimitOverrideBytes,
  )
}

export async function refreshStorageLimit(tx: Transaction, userId: string, now = new Date()): Promise<boolean> {
  const entitlement = await loadStorageEntitlement(tx, userId, now)
  const changed = await tx.update(users).set({ storageLimitBytes: entitlement.storageLimitBytes, updatedAt: new Date() })
    .where(and(eq(users.id, userId), ne(users.storageLimitBytes, entitlement.storageLimitBytes)))
    .returning({ id: users.id })
  return changed.length > 0
}

export async function newUserStorageLimit(tx: Transaction): Promise<number> {
  const billingEnabled = getConfig().PULPO_BILLING_ENABLED
  const key = billingEnabled ? 'billing' : 'auth'
  const [setting] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, key)).limit(1)
  return billingEnabled
    ? parseBillingSettings(setting?.value).babyStorageLimitBytes
    : parseAuthSettings(setting?.value).defaultStorageLimitBytes
}
