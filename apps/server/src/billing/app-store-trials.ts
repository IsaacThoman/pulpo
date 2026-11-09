import { and, count, eq, gte } from 'drizzle-orm'
import { db } from '../database/client.js'
import { billingOrders } from '../database/schema.js'
import { getConfig, type Config } from '../config.js'
import { acceptedAppStoreEnvironments } from './app-store.js'

/** The daily trial limit counts trials started in any window this long. */
export const APP_STORE_TRIAL_WINDOW_MS = 24 * 60 * 60 * 1_000

type Database = Pick<typeof db, 'select'>

/**
 * App Store free trials started in the last 24 hours, sandbox ones included so TestFlight can
 * exercise the limit. Apple decides who gets a trial, so this counts what it granted.
 */
export async function appStoreTrialsStarted(database: Database = db, now = new Date()): Promise<number> {
  const [row] = await database.select({ value: count() }).from(billingOrders).where(and(
    eq(billingOrders.provider, 'app_store'),
    eq(billingOrders.freeTrial, true),
    gte(billingOrders.paidAt, new Date(now.getTime() - APP_STORE_TRIAL_WINDOW_MS)),
  ))
  return Number(row?.value ?? 0)
}

/** Whether this server sells a free-trial product at all: App Store billing on, the product set, a nonzero limit. */
export function appStoreTrialsConfigured(trialsPerDay: number, config: Config = getConfig()): boolean {
  return acceptedAppStoreEnvironments(config).length > 0 && Boolean(config.APP_STORE_EIGHT_TRIAL_PRODUCT_ID) && trialsPerDay > 0
}

/**
 * Whether the iOS app should sell Eight as the free-trial product to this account now. Only accounts
 * that never subscribed get it, since Apple also grants trials to lapsed subscribers. The limit is
 * approximate: a paywall left open after the limit fills still sells the trial product.
 */
export async function appStoreFreeTrialOffered(input: {
  trialsPerDay: number
  hasSubscriptionHistory: boolean
}, database: Database = db, config: Config = getConfig()): Promise<boolean> {
  if (input.hasSubscriptionHistory || !appStoreTrialsConfigured(input.trialsPerDay, config)) return false
  return await appStoreTrialsStarted(database) < input.trialsPerDay
}
