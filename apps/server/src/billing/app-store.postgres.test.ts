import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { appStoreSubscriptions, appStoreTransactions, billingAccounts, billingWebhookEvents, users } from '../database/schema.js'
import { DEFAULT_EIGHT_STORAGE_LIMIT_BYTES, DEFAULT_FAT_STORAGE_LIMIT_BYTES } from '../settings/application-settings.js'
import { signTestAppStorePayload, testAppStoreRoot } from './fixtures/app-store/sign.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() } }))
vi.mock('../config.js', async (original) => {
  const config = await original<typeof import('../config.js')>()
  return {
    ...config,
    getConfig: () => ({
      ...config.getConfig(),
      PULPO_BILLING_ENABLED: true,
      APP_STORE_BILLING_ENABLED: true,
      APP_STORE_BUNDLE_ID: 'com.isaacthoman.pulpo',
      APP_STORE_APP_APPLE_ID: 6_740_000_000,
      APP_STORE_EIGHT_PRODUCT_ID: 'baby.pulpo.eight.monthly',
      APP_STORE_FAT_PRODUCT_ID: 'baby.pulpo.fat.monthly',
      APP_STORE_ACCEPT_SANDBOX: true,
    }),
  }
})

const { processAppStoreNotification, syncAppStoreTransaction } = await import('./app-store.js')
const { getBillingEntitlements } = await import('./entitlements.js')
const { createSubscriptionCheckout } = await import('./stripe.js')

const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('App Store billing tests require a migrated disposable database named pulpo_budget_test')
}

const options = { trustedRoots: [testAppStoreRoot] }
const day = 24 * 60 * 60 * 1_000
const userIds: string[] = []

async function account() {
  const id = randomUUID()
  userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, username: id, name: 'App Store QA' })
  return id
}

function signedTransaction(input: { userId?: string; originalTransactionId: string; transactionId?: string; productId?: string; start?: number; signedDate?: number; revocationDate?: number }) {
  const start = input.start ?? Date.now() - day
  return signTestAppStorePayload({
    transactionId: input.transactionId ?? input.originalTransactionId,
    originalTransactionId: input.originalTransactionId,
    bundleId: 'com.isaacthoman.pulpo',
    productId: input.productId ?? 'baby.pulpo.eight.monthly',
    type: 'Auto-Renewable Subscription',
    environment: 'Sandbox',
    purchaseDate: start,
    expiresDate: start + 30 * day,
    signedDate: input.signedDate ?? start,
    inAppOwnershipType: 'PURCHASED',
    ...(input.userId ? { appAccountToken: input.userId } : {}),
    ...(input.revocationDate ? { revocationDate: input.revocationDate, revocationReason: 0 } : {}),
  })
}

function signedRenewal(originalTransactionId: string, productId = 'baby.pulpo.eight.monthly', signedDate = Date.now() - day) {
  return signTestAppStorePayload({
    originalTransactionId, environment: 'Sandbox', signedDate, autoRenewProductId: productId, autoRenewStatus: 1,
  })
}

function notification(type: string, signedTransactionInfo: string, signedRenewalInfo?: string) {
  return signTestAppStorePayload({
    notificationType: type,
    notificationUUID: randomUUID(),
    signedDate: Date.now(),
    data: { environment: 'Sandbox', bundleId: 'com.isaacthoman.pulpo', signedTransactionInfo, signedRenewalInfo },
  })
}

describe.skipIf(!enabled)('App Store subscriptions in PostgreSQL', () => {
  afterAll(async () => {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    await queryClient.end()
  })

  it('grants the plan a purchase syncs and refreshes the storage limit', async () => {
    const userId = await account()
    const originalTransactionId = `${Date.now()}1`
    const summary = await syncAppStoreTransaction(userId, {
      signedTransaction: signedTransaction({ userId, originalTransactionId }),
      signedRenewalInfo: signedRenewal(originalTransactionId),
    }, options)
    expect(summary).toMatchObject({ provider: 'app_store', plan: 'eight', status: 'active', cancelAtPeriodEnd: false })
    expect((await getBillingEntitlements(userId)).plan).toBe('eight')
    const [user] = await db.select({ storageLimitBytes: users.storageLimitBytes }).from(users).where(eq(users.id, userId))
    expect(user!.storageLimitBytes).toBe(DEFAULT_EIGHT_STORAGE_LIMIT_BYTES)
    expect(await db.select().from(appStoreTransactions).where(eq(appStoreTransactions.userId, userId))).toHaveLength(1)

    // Syncing the same purchase again changes nothing.
    await syncAppStoreTransaction(userId, { signedTransaction: signedTransaction({ userId, originalTransactionId }) }, options)
    expect(await db.select().from(appStoreSubscriptions).where(eq(appStoreSubscriptions.userId, userId))).toHaveLength(1)
  })

  it('refuses a subscription bought for, or already linked to, another account', async () => {
    const owner = await account()
    const other = await account()
    await expect(syncAppStoreTransaction(other, {
      signedTransaction: signedTransaction({ userId: owner, originalTransactionId: `${Date.now()}2` }),
    }, options)).rejects.toMatchObject({ code: 'app_store_account_mismatch' })

    // An offer code redeemed in the App Store has no account token; the first account to sync it owns it.
    const originalTransactionId = `${Date.now()}3`
    await syncAppStoreTransaction(owner, { signedTransaction: signedTransaction({ originalTransactionId }) }, options)
    await expect(syncAppStoreTransaction(other, { signedTransaction: signedTransaction({ originalTransactionId }) }, options))
      .rejects.toMatchObject({ code: 'app_store_account_mismatch' })
    expect((await getBillingEntitlements(other)).plan).toBe('baby')
  })

  it('applies renewals and upgrades from server notifications once', async () => {
    const userId = await account()
    const originalTransactionId = `${Date.now()}4`
    const start = Date.now() - 31 * day
    const first = signedTransaction({ userId, originalTransactionId, start })
    await processAppStoreNotification(notification('SUBSCRIBED', first, signedRenewal(originalTransactionId, undefined, start)), options)
    // The first period has ended.
    expect((await getBillingEntitlements(userId)).plan).toBe('baby')

    const renewal = signedTransaction({ userId, originalTransactionId, transactionId: `${originalTransactionId}5`, start: start + 30 * day })
    const payload = notification('DID_RENEW', renewal)
    await processAppStoreNotification(payload, options)
    await processAppStoreNotification(payload, options)
    expect((await getBillingEntitlements(userId)).plan).toBe('eight')
    expect(await db.select().from(appStoreTransactions).where(eq(appStoreTransactions.originalTransactionId, originalTransactionId))).toHaveLength(2)

    const upgrade = signedTransaction({
      userId, originalTransactionId, transactionId: `${originalTransactionId}6`, productId: 'baby.pulpo.fat.monthly', start: Date.now() - day / 2,
    })
    await processAppStoreNotification(notification('DID_CHANGE_RENEWAL_PREF', upgrade, signedRenewal(originalTransactionId, 'baby.pulpo.fat.monthly', Date.now())), options)
    expect((await getBillingEntitlements(userId)).plan).toBe('fat')
    const [user] = await db.select({ storageLimitBytes: users.storageLimitBytes }).from(users).where(eq(users.id, userId))
    expect(user!.storageLimitBytes).toBe(DEFAULT_FAT_STORAGE_LIMIT_BYTES)
  })

  it('revokes a refunded subscription and places a billing hold', async () => {
    const userId = await account()
    const originalTransactionId = `${Date.now()}7`
    const start = Date.now() - day
    await syncAppStoreTransaction(userId, { signedTransaction: signedTransaction({ userId, originalTransactionId, start }) }, options)
    await processAppStoreNotification(notification('REFUND', signedTransaction({
      userId, originalTransactionId, start, signedDate: Date.now(), revocationDate: Date.now(),
    })), options)
    const [subscription] = await db.select().from(appStoreSubscriptions).where(eq(appStoreSubscriptions.originalTransactionId, originalTransactionId))
    expect(subscription).toMatchObject({ status: 'revoked', paidThrough: null })
    const entitlements = await getBillingEntitlements(userId)
    expect(entitlements).toMatchObject({ plan: 'baby', onHold: true })
    const [hold] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, userId))
    expect(hold).toMatchObject({ holdReason: 'payment_refunded', holdReference: `app_store:${originalTransactionId}` })
  })

  it('acknowledges notifications it cannot attribute', async () => {
    const originalTransactionId = `${Date.now()}8`
    const payload = notification('SUBSCRIBED', signedTransaction({ userId: randomUUID(), originalTransactionId }))
    await processAppStoreNotification(payload, options)
    const events = await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.resourceId, originalTransactionId))
    expect(events).toMatchObject([{ type: 'app_store.SUBSCRIBED', status: 'processed' }])
    expect(await db.select().from(appStoreSubscriptions).where(eq(appStoreSubscriptions.originalTransactionId, originalTransactionId))).toEqual([])
  })

  it('keeps App Store subscribers out of web checkout until their plan ends', async () => {
    const userId = await account()
    await syncAppStoreTransaction(userId, { signedTransaction: signedTransaction({ userId, originalTransactionId: `${Date.now()}9` }) }, options)
    await expect(createSubscriptionCheckout({ userId, plan: 'fat', idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'app_store_subscription_exists' })
  })
})
