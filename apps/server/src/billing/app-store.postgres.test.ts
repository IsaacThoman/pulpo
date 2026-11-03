import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { billingAccounts, billingOrders, billingSubscriptions, billingWebhookEvents, users } from '../database/schema.js'
import type { AppStoreSubscriptionStatus } from './app-store.js'
import { signAppStorePayload, testAppStoreRoot } from './app-store-test-signing.js'

const apple = vi.hoisted(() => ({
  environments: ['production', 'sandbox'] as Array<'production' | 'sandbox'>,
  statuses: new Map<string, AppStoreSubscriptionStatus | Error>(),
  history: new Map<string, string[]>(),
}))

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() } }))
vi.mock('../config.js', async (original) => {
  const config = await original<typeof import('../config.js')>()
  const appStoreConfig = () => ({
    ...config.getConfig(),
    PULPO_BILLING_ENABLED: true,
    APP_STORE_BUNDLE_ID: 'com.example.pulpo',
    APP_STORE_APP_APPLE_ID: 1234567890,
    APP_STORE_ISSUER_ID: 'issuer',
    APP_STORE_KEY_ID: 'KEY123',
    APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nunused\n-----END PRIVATE KEY-----',
    APP_STORE_EIGHT_PRODUCT_ID: 'pulpoEight',
    APP_STORE_FAT_PRODUCT_ID: 'pulpoFat',
    APP_STORE_ENVIRONMENTS: apple.environments,
  })
  return {
    ...config,
    getConfig: appStoreConfig,
    appStoreBillingEnabled: () => true,
  }
})
vi.mock('./app-store.js', async (original) => {
  const actual = await original<typeof import('./app-store.js')>()
  const { getConfig } = await import('../config.js')
  return {
    ...actual,
    getAppStoreGateway: () => ({
      ...actual.createAppStoreGateway({ config: getConfig(), rootCertificates: [testAppStoreRoot], enableOnlineChecks: false }),
      async subscriptionStatus(_environment: string, originalTransactionId: string) {
        const status = apple.statuses.get(originalTransactionId)
        if (status instanceof Error) throw status
        return status ?? null
      },
      async *transactionHistory(_environment: string, originalTransactionId: string) {
        yield* apple.history.get(originalTransactionId) ?? []
      },
    }),
  }
})

const { appStoreAccountToken, processAppStoreNotification, reconcileAppStoreBilling, revokeSandboxSubscriptions, syncAppStorePurchase } = await import('./app-store-sync.js')
const { getBillingEntitlements } = await import('./entitlements.js')

const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('App Store billing tests require a migrated disposable database named pulpo_budget_test')
}

const DAY = 86_400_000
const userIds: string[] = []
const notificationIds: string[] = []
let sequence = 0

function transactionId(): string {
  sequence += 1
  return `${Date.now()}${String(sequence).padStart(4, '0')}`
}

type Environment = 'Production' | 'Sandbox'

function transaction(input: { id?: string; original: string; product?: string; token?: string; environment?: Environment } & Record<string, unknown>) {
  const { id, original, product, token, environment, ...rest } = input
  return {
    transactionId: id ?? original,
    originalTransactionId: original,
    bundleId: 'com.example.pulpo',
    productId: product ?? 'pulpoEight',
    purchaseDate: Date.now(),
    expiresDate: Date.now() + 30 * DAY,
    signedDate: Date.now(),
    environment: environment ?? 'Production',
    transactionReason: id && id !== original ? 'RENEWAL' : 'PURCHASE',
    inAppOwnershipType: 'PURCHASED',
    currency: 'USD',
    price: product === 'pulpoFat' ? 29_990 : 9_990,
    ...(token ? { appAccountToken: token } : {}),
    ...rest,
  }
}

function renewal(input: { original: string; product: string; autoRenewProduct?: string; autoRenew?: boolean; environment?: Environment }) {
  return signAppStorePayload({
    originalTransactionId: input.original,
    productId: input.product,
    autoRenewProductId: input.autoRenewProduct ?? input.product,
    autoRenewStatus: input.autoRenew === false ? 0 : 1,
    signedDate: Date.now(),
    environment: input.environment ?? 'Production',
  })
}

/** Makes Apple's status API report `status` with `latest` as the subscription's current transaction. */
function appleReports(status: number, latest: ReturnType<typeof transaction>, renewalInfo?: string): string {
  const signed = signAppStorePayload(latest)
  apple.statuses.set(latest.originalTransactionId, {
    status,
    signedTransactionInfo: signed,
    signedRenewalInfo: renewalInfo ?? renewal({ original: latest.originalTransactionId, product: latest.productId, environment: latest.environment as Environment }),
  })
  return signed
}

function notification(input: {
  type: string
  subtype?: string
  status?: number
  transaction: ReturnType<typeof transaction>
  renewal?: string
}) {
  const id = randomUUID()
  notificationIds.push(id)
  return {
    id,
    payload: signAppStorePayload({
      notificationType: input.type,
      ...(input.subtype ? { subtype: input.subtype } : {}),
      notificationUUID: id,
      version: '2.0',
      signedDate: Date.now(),
      data: {
        environment: input.transaction.environment,
        bundleId: 'com.example.pulpo',
        appAppleId: 1234567890,
        status: input.status ?? 1,
        signedTransactionInfo: signAppStorePayload(input.transaction),
        signedRenewalInfo: input.renewal ?? renewal({ original: input.transaction.originalTransactionId, product: input.transaction.productId }),
      },
    }),
  }
}

async function newUser(): Promise<string> {
  const userId = randomUUID()
  userIds.push(userId)
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, username: userId, name: 'App Store QA' })
  return userId
}

async function subscription(original: string) {
  const [row] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.providerSubscriptionId, original))
  return row
}

async function ordersFor(original: string) {
  return db.select().from(billingOrders).where(eq(billingOrders.providerSubscriptionId, original)).orderBy(billingOrders.paidAt)
}

async function account(userId: string) {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, userId))
  return row
}

/** A user who bought `product` in the app, with the subscription Apple reports as active. */
async function subscriber(product = 'pulpoEight') {
  const userId = await newUser()
  const token = await appStoreAccountToken(userId)
  const original = transactionId()
  const latest = transaction({ original, product, token })
  const signed = appleReports(1, latest)
  await syncAppStorePurchase(userId, signed)
  return { userId, token, original, latest, signed }
}

describe.skipIf(!enabled)('App Store billing in PostgreSQL', () => {
  afterEach(() => { apple.environments = ['production', 'sandbox'] })
  afterAll(async () => {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    if (notificationIds.length) await db.delete(billingWebhookEvents).where(inArray(billingWebhookEvents.providerEventId, notificationIds))
    await queryClient.end()
  })

  it('grants the plan for a purchase and records the order after Apple’s commission', async () => {
    const { userId, token, original } = await subscriber()

    expect(await appStoreAccountToken(userId)).toBe(token)
    expect(await subscription(original)).toMatchObject({
      provider: 'app_store', providerEnvironment: 'production', userId, status: 'active', plan: 'eight', paidPlan: 'eight', cancelAtPeriodEnd: false,
    })
    expect(await ordersFor(original)).toMatchObject([{
      provider: 'app_store', status: 'paid', billingReason: 'subscription_create', currency: 'usd',
      netAmountCents: 999, totalAmountCents: 999, processingFeeAmountCents: 150, grantedCreditMicros: 0,
    }])
    expect((await getBillingEntitlements(userId)).plan).toBe('eight')
  })

  it('keeps a subscription with the account that bought it', async () => {
    const { token, signed } = await subscriber()
    const other = await newUser()

    await expect(syncAppStorePurchase(other, signed))
      .rejects.toMatchObject({ statusCode: 409, code: 'app_store_subscription_other_account' })

    const original = transactionId()
    const boughtWithAnotherToken = appleReports(1, transaction({ original, token }))
    await expect(syncAppStorePurchase(other, boughtWithAnotherToken))
      .rejects.toMatchObject({ statusCode: 409, code: 'app_store_subscription_other_account' })
    expect(await subscription(original)).toBeUndefined()
    expect((await getBillingEntitlements(other)).plan).toBe('baby')
  })

  it('grants sandbox purchases only to accounts an admin allows, and ends them when that is turned off', async () => {
    const userId = await newUser()
    const token = await appStoreAccountToken(userId)
    const original = transactionId()
    const purchase = transaction({ original, token, environment: 'Sandbox', expiresDate: Date.now() + 3 * 60_000 })
    const signed = appleReports(1, purchase)

    await expect(syncAppStorePurchase(userId, signed)).rejects.toMatchObject({ statusCode: 403, code: 'app_store_sandbox_not_allowed' })
    expect(await subscription(original)).toBeUndefined()

    await db.update(billingAccounts).set({ appStoreSandboxAllowed: true }).where(eq(billingAccounts.userId, userId))
    await expect(syncAppStorePurchase(userId, signed)).resolves.toEqual({ plan: 'eight' })
    expect(await subscription(original)).toMatchObject({ providerEnvironment: 'sandbox', status: 'active' })
    expect(await ordersFor(original)).toMatchObject([{ netAmountCents: 0, processingFeeAmountCents: 0 }])

    // Sandbox months last minutes; the frequent sync picks up renewals without notifications.
    const renewed = transaction({ id: transactionId(), original, token, environment: 'Sandbox', expiresDate: Date.now() + 8 * 60_000 })
    appleReports(1, renewed)
    await reconcileAppStoreBilling({ sandboxRenewals: true })
    expect((await subscription(original))?.paidThrough?.getTime()).toBe(renewed.expiresDate)
    expect(await ordersFor(original)).toHaveLength(2)

    await db.transaction((tx) => revokeSandboxSubscriptions(tx, userId))
    expect(await subscription(original)).toMatchObject({ status: 'canceled', paidThrough: null })
    expect((await getBillingEntitlements(userId)).plan).toBe('baby')
  })

  it('refuses purchases from an environment this server does not accept', async () => {
    apple.environments = ['sandbox']
    const userId = await newUser()
    const original = transactionId()
    const signed = appleReports(1, transaction({ original }))

    await expect(syncAppStorePurchase(userId, signed))
      .rejects.toMatchObject({ statusCode: 403, code: 'app_store_environment_not_supported' })
  })

  it('rejects a transaction that is not signed by the App Store chain', async () => {
    const userId = await newUser()
    const original = transactionId()
    const [header, payload] = appleReports(1, transaction({ original })).split('.')

    await expect(syncAppStorePurchase(userId, `${header}.${payload}.${Buffer.from('forged').toString('base64url')}`))
      .rejects.toMatchObject({ statusCode: 400, code: 'invalid_app_store_transaction' })
    expect(await subscription(original)).toBeUndefined()
  })

  it('grants from the posted transaction when Apple’s API is unavailable', async () => {
    const userId = await newUser()
    const original = transactionId()
    const signed = signAppStorePayload(transaction({ original, product: 'pulpoFat' }))
    apple.statuses.set(original, new Error('App Store Server API timed out'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await expect(syncAppStorePurchase(userId, signed)).resolves.toEqual({ plan: 'fat' })
    } finally {
      warn.mockRestore()
      apple.statuses.delete(original)
    }
    expect(await subscription(original)).toMatchObject({ status: 'active', plan: 'fat' })
  })

  it('applies renewals and downgrades from notifications, once each', async () => {
    const { userId, token, original } = await subscriber('pulpoFat')
    const renewed = transaction({ id: transactionId(), original, token, product: 'pulpoFat', expiresDate: Date.now() + 60 * DAY })
    const renewal1 = notification({ type: 'DID_RENEW', transaction: renewed })

    await processAppStoreNotification(renewal1.payload)
    await processAppStoreNotification(renewal1.payload)

    expect(await ordersFor(original)).toMatchObject([
      { billingReason: 'subscription_create', netAmountCents: 2_999 },
      { billingReason: 'subscription_cycle', netAmountCents: 2_999 },
    ])
    expect((await subscription(original))?.paidThrough?.getTime()).toBe(renewed.expiresDate)
    const events = await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.providerEventId, renewal1.id))
    expect(events).toMatchObject([{ provider: 'app_store', type: 'DID_RENEW', status: 'processed', resourceId: original }])

    await processAppStoreNotification(notification({
      type: 'DID_CHANGE_RENEWAL_PREF',
      subtype: 'DOWNGRADE',
      transaction: renewed,
      renewal: renewal({ original, product: 'pulpoFat', autoRenewProduct: 'pulpoEight' }),
    }).payload)

    expect(await subscription(original)).toMatchObject({ plan: 'eight', paidPlan: 'fat', providerProductId: 'pulpoFat' })
    expect((await getBillingEntitlements(userId)).plan).toBe('fat')
  })

  it('treats a refund like a Stripe refund: refunded order, one billing hold, and no plan', async () => {
    const { userId, original, latest } = await subscriber()
    const refunded = { ...latest, revocationDate: Date.now(), revocationReason: 0, revocationType: 'REFUND_FULL', signedDate: Date.now() }

    await processAppStoreNotification(notification({ type: 'REFUND', status: 5, transaction: refunded }).payload)

    expect(await ordersFor(original)).toMatchObject([{ status: 'refunded', refundedAmountCents: 999 }])
    expect(await account(userId)).toMatchObject({ holdReason: 'payment_refunded', holdReference: original, holdClearedAt: null })
    expect(await subscription(original)).toMatchObject({ status: 'canceled', paidThrough: null })
    expect((await getBillingEntitlements(userId)).plan).toBe('baby')

    // An admin clears the hold; replaying the same refund must not place it again.
    await db.update(billingAccounts).set({ holdClearedAt: new Date() }).where(eq(billingAccounts.userId, userId))
    appleReports(5, refunded, renewal({ original, product: 'pulpoEight' }))
    apple.history.set(original, [signAppStorePayload(refunded)])
    await reconcileAppStoreBilling()
    expect((await account(userId))?.holdClearedAt).not.toBeNull()
  })

  it('ignores notifications for subscriptions no account here owns', async () => {
    const original = transactionId()
    const unknown = notification({ type: 'SUBSCRIBED', subtype: 'INITIAL_BUY', transaction: transaction({ original, token: randomUUID() }) })

    await processAppStoreNotification(unknown.payload)

    expect(await subscription(original)).toBeUndefined()
    const [event] = await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.providerEventId, unknown.id))
    expect(event).toMatchObject({ status: 'processed' })
  })

  it('acknowledges Apple’s test notification', async () => {
    const id = randomUUID()
    notificationIds.push(id)
    await processAppStoreNotification(signAppStorePayload({
      notificationType: 'TEST',
      notificationUUID: id,
      version: '2.0',
      signedDate: Date.now(),
      data: { environment: 'Production', bundleId: 'com.example.pulpo', appAppleId: 1234567890 },
    }))

    const [event] = await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.providerEventId, id))
    expect(event).toMatchObject({ provider: 'app_store', type: 'TEST', status: 'processed', resourceId: null })
  })

  it('assigns a subscription from a notification when the app never reported the purchase', async () => {
    const userId = await newUser()
    const token = await appStoreAccountToken(userId)
    const original = transactionId()

    await processAppStoreNotification(notification({ type: 'SUBSCRIBED', subtype: 'INITIAL_BUY', transaction: transaction({ original, token }) }).payload)

    expect(await subscription(original)).toMatchObject({ userId, status: 'active' })
  })

  it('ignores notifications from an environment this server does not accept', async () => {
    const { original, latest } = await subscriber()
    apple.environments = ['sandbox']
    const expired = notification({ type: 'EXPIRED', status: 2, transaction: { ...latest, expiresDate: Date.now() - 1_000 } })

    await processAppStoreNotification(expired.payload)

    expect(await subscription(original)).toMatchObject({ status: 'active' })
    expect(await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.providerEventId, expired.id))).toEqual([])
  })

  it('reconciles expirations and renewals it missed', async () => {
    const { userId, token, original, latest } = await subscriber()
    const missed = transaction({ id: transactionId(), original, token, purchaseDate: Date.now(), expiresDate: Date.now() - 1_000 })
    appleReports(2, missed, renewal({ original, product: 'pulpoEight', autoRenew: false }))
    apple.history.set(original, [signAppStorePayload(latest), signAppStorePayload(missed)])

    await reconcileAppStoreBilling()

    expect(await subscription(original)).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true })
    expect((await ordersFor(original)).map((order) => order.providerPaymentId)).toEqual([original, missed.transactionId])
    expect((await getBillingEntitlements(userId)).plan).toBe('baby')
    expect((await account(userId))?.holdAt ?? null).toBeNull()
  })
})
