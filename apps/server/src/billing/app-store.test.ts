import { describe, expect, it } from 'vitest'
import { Status, VerificationException, VerificationStatus } from '@apple/app-store-server-library'
import { appStoreBillingEnabled, parseConfig } from '../config.js'
import {
  acceptedAppStoreEnvironments,
  appStoreBillingReason,
  appStoreOrderAmounts,
  appStorePlanForProduct,
  appStoreSubscriptionState,
  appStoreVerificationError,
  claimedAppStoreEnvironment,
  createAppStoreGateway,
  statusFromTransaction,
  type AppStoreTransaction,
} from './app-store.js'
import { appStoreSubscriptionOwner } from './app-store-sync.js'
import { APPLE_ROOT_CA_G3_PEM } from './apple-root-certificates.js'
import { signAppStorePayload, testAppStoreRoot, testSigningKey } from './app-store-test-signing.js'

const stripeEnvironment = {
  PULPO_BILLING_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_CREDIT_PRODUCT_ID: 'prod_credits',
  STRIPE_EIGHT_PRICE_ID: 'price_eight',
  STRIPE_FAT_PRICE_ID: 'price_fat',
}
const appStoreEnvironment = {
  APP_STORE_BUNDLE_ID: 'com.example.pulpo',
  APP_STORE_APP_APPLE_ID: '1234567890',
  APP_STORE_ISSUER_ID: 'issuer',
  APP_STORE_KEY_ID: 'KEY123',
  APP_STORE_PRIVATE_KEY: testSigningKey.trim().replaceAll('\n', '\\n'),
  APP_STORE_EIGHT_PRODUCT_ID: 'pulpoEight',
  APP_STORE_FAT_PRODUCT_ID: 'pulpoFat',
}
const config = parseConfig({ ...stripeEnvironment, ...appStoreEnvironment })
const DAY = 86_400_000
const now = Date.now()

function transaction(overrides: Partial<AppStoreTransaction> = {}): AppStoreTransaction {
  return {
    transactionId: '2000000001',
    originalTransactionId: '2000000001',
    bundleId: 'com.example.pulpo',
    productId: 'pulpoEight',
    purchaseDate: now - DAY,
    expiresDate: now + 29 * DAY,
    signedDate: now,
    environment: 'Production',
    transactionReason: 'PURCHASE',
    currency: 'USD',
    price: 9_990,
    ...overrides,
  }
}

describe('App Store configuration', () => {
  it('turns on only when billing is enabled and every App Store setting is present', () => {
    expect(appStoreBillingEnabled(config)).toBe(true)
    expect(acceptedAppStoreEnvironments(config)).toEqual(['production', 'sandbox'])
    expect(appStoreBillingEnabled(parseConfig(stripeEnvironment))).toBe(false)
    expect(acceptedAppStoreEnvironments(parseConfig(stripeEnvironment))).toEqual([])
    expect(appStoreBillingEnabled(parseConfig({ ...appStoreEnvironment }))).toBe(false)
  })

  it('refuses a private key that does not parse', () => {
    expect(() => parseConfig({ ...stripeEnvironment, ...appStoreEnvironment, APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----' }))
      .toThrow('Use the .p8 In-App Purchase key')
  })

  it('explains a key cut off after its first line', () => {
    expect(() => parseConfig({ ...stripeEnvironment, ...appStoreEnvironment, APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----' }))
      .toThrow('The key was cut off after its first line')
  })

  it('refuses a partial App Store configuration', () => {
    expect(() => parseConfig({ ...stripeEnvironment, ...appStoreEnvironment, APP_STORE_KEY_ID: '' }))
      .toThrow('App Store billing is partly configured; missing: APP_STORE_KEY_ID')
  })

  it('reads a private key stored on one line and limits environments', () => {
    const staging = parseConfig({ ...stripeEnvironment, ...appStoreEnvironment, APP_STORE_ENVIRONMENTS: 'sandbox' })
    expect(staging.APP_STORE_PRIVATE_KEY).toBe(testSigningKey.trim())
    const flattened = parseConfig({ ...stripeEnvironment, ...appStoreEnvironment, APP_STORE_PRIVATE_KEY: testSigningKey.trim().replaceAll('\n', ' ') })
    expect(flattened.APP_STORE_PRIVATE_KEY).toBe(testSigningKey.trim())
    expect(acceptedAppStoreEnvironments(staging)).toEqual(['sandbox'])
    expect(() => parseConfig({ ...stripeEnvironment, ...appStoreEnvironment, APP_STORE_ENVIRONMENTS: 'xcode' })).toThrow()
  })

  it('maps product IDs to plans', () => {
    expect(appStorePlanForProduct('pulpoEight', config)).toBe('eight')
    expect(appStorePlanForProduct('pulpoFat', config)).toBe('fat')
    expect(appStorePlanForProduct('price_eight', config)).toBeNull()
  })
})

describe('App Store subscription state', () => {
  const expires = new Date(now + 29 * DAY)

  it.each([
    [Status.ACTIVE, 'active', expires],
    [Status.BILLING_RETRY, 'past_due', expires],
    [Status.EXPIRED, 'canceled', expires],
    [Status.REVOKED, 'canceled', null],
  ])('maps status %s to %s', (status, expected, paidThrough) => {
    expect(appStoreSubscriptionState({ status, transaction: transaction() }, config)).toMatchObject({
      status: expected, paidThrough, plan: 'eight', paidPlan: 'eight',
    })
  })

  it('keeps access through the grace period', () => {
    const graceEnds = now + 45 * DAY
    expect(appStoreSubscriptionState({
      status: Status.BILLING_GRACE_PERIOD,
      transaction: transaction(),
      renewal: { gracePeriodExpiresDate: graceEnds, autoRenewStatus: 1 },
    }, config)).toMatchObject({ status: 'past_due', paidThrough: new Date(graceEnds) })
  })

  it('keeps the paid plan until renewal after a downgrade, and records a cancellation', () => {
    expect(appStoreSubscriptionState({
      status: Status.ACTIVE,
      transaction: transaction({ productId: 'pulpoFat' }),
      renewal: { autoRenewProductId: 'pulpoEight', autoRenewStatus: 0 },
    }, config)).toMatchObject({ plan: 'eight', paidPlan: 'fat', cancelAtPeriodEnd: true })
  })

  it('ends access for a refunded transaction even while Apple still reports it active', () => {
    expect(appStoreSubscriptionState({ status: Status.ACTIVE, transaction: transaction({ revocationDate: now }) }, config))
      .toMatchObject({ status: 'canceled', paidThrough: null })
  })

  it('does not treat an upgraded transaction as refunded', () => {
    const upgraded = transaction({ revocationDate: now, isUpgraded: true })
    expect(statusFromTransaction(upgraded)).toBe(Status.ACTIVE)
    expect(appStoreSubscriptionState({ status: Status.ACTIVE, transaction: upgraded }, config)).toMatchObject({ status: 'active' })
  })

  it('ignores products that are not Pulpo plans', () => {
    expect(appStoreSubscriptionState({ status: Status.ACTIVE, transaction: transaction({ productId: 'other' }) }, config)).toBeNull()
  })
})

describe('App Store orders', () => {
  it('uses the charged US price and records Apple’s commission', () => {
    expect(appStoreOrderAmounts(transaction(), { environment: 'production', plan: 'eight' }))
      .toEqual({ netCents: 999, feeCents: 150, refundCents: 999 })
  })

  it('uses the US list price for other currencies', () => {
    expect(appStoreOrderAmounts(transaction({ currency: 'JPY', price: 4_500_000 }), { environment: 'production', plan: 'fat' }))
      .toMatchObject({ netCents: 2_999 })
  })

  it('records sandbox purchases and free trials at zero', () => {
    expect(appStoreOrderAmounts(transaction(), { environment: 'sandbox', plan: 'eight' }).netCents).toBe(0)
    expect(appStoreOrderAmounts(transaction({ price: 0 }), { environment: 'production', plan: 'eight' }).netCents).toBe(0)
  })

  it('applies partial refunds', () => {
    expect(appStoreOrderAmounts(transaction({ revocationPercentage: 50_000 }), { environment: 'production', plan: 'eight' }).refundCents).toBe(500)
  })

  it('names the billing reason', () => {
    expect(appStoreBillingReason(transaction())).toBe('subscription_create')
    expect(appStoreBillingReason(transaction({ transactionId: '2000000002', transactionReason: 'RENEWAL' }))).toBe('subscription_cycle')
    expect(appStoreBillingReason(transaction({ transactionId: '2000000003' }))).toBe('subscription_update')
  })
})

describe('App Store subscription ownership', () => {
  it('keeps a subscription with the account that claimed it first', () => {
    expect(appStoreSubscriptionOwner({ boundUserId: 'a', tokenUserId: 'b', claimant: null })).toEqual({ userId: 'a' })
    expect(appStoreSubscriptionOwner({ boundUserId: 'a', tokenUserId: null, claimant: 'b' })).toBe('other_account')
    expect(appStoreSubscriptionOwner({ boundUserId: 'a', tokenUserId: null, claimant: 'a' })).toEqual({ userId: 'a' })
  })

  it('refuses a claim on a purchase made with another account’s token', () => {
    expect(appStoreSubscriptionOwner({ boundUserId: null, tokenUserId: 'a', claimant: 'b' })).toBe('other_account')
    expect(appStoreSubscriptionOwner({ boundUserId: null, tokenUserId: null, claimant: 'b' })).toEqual({ userId: 'b' })
  })

  it('assigns an unclaimed subscription by its token, or to nobody', () => {
    expect(appStoreSubscriptionOwner({ boundUserId: null, tokenUserId: 'a', claimant: null })).toEqual({ userId: 'a' })
    expect(appStoreSubscriptionOwner({ boundUserId: null, tokenUserId: null, claimant: null })).toBeNull()
  })
})

describe('App Store signature verification', () => {
  const gateway = createAppStoreGateway({ config, rootCertificates: [testAppStoreRoot], enableOnlineChecks: false })

  it('verifies a signed transaction', async () => {
    const signed = signAppStorePayload({ ...transaction() })
    await expect(gateway.verifyTransaction('production', signed)).resolves.toMatchObject({ productId: 'pulpoEight' })
    expect(claimedAppStoreEnvironment(signed, 'transaction')).toBe('production')
  })

  it('rejects another app’s transaction', async () => {
    const signed = signAppStorePayload({ ...transaction({ bundleId: 'com.example.other' }) })
    await expect(gateway.verifyTransaction('production', signed))
      .rejects.toMatchObject({ status: VerificationStatus.INVALID_APP_IDENTIFIER })
  })

  it('rejects a sandbox transaction presented as a production one', async () => {
    const signed = signAppStorePayload({ ...transaction({ environment: 'Sandbox' }) })
    expect(claimedAppStoreEnvironment(signed, 'transaction')).toBe('sandbox')
    await expect(gateway.verifyTransaction('production', signed))
      .rejects.toMatchObject({ status: VerificationStatus.INVALID_ENVIRONMENT })
  })

  it('rejects a tampered payload', async () => {
    const [header, , signature] = signAppStorePayload({ ...transaction() }).split('.')
    const forged = Buffer.from(JSON.stringify(transaction({ productId: 'pulpoFat' }))).toString('base64url')
    await expect(gateway.verifyTransaction('production', `${header}.${forged}.${signature}`))
      .rejects.toBeInstanceOf(VerificationException)
  })

  it('rejects data not signed by Apple', async () => {
    const apple = createAppStoreGateway({ config, rootCertificates: [Buffer.from(APPLE_ROOT_CA_G3_PEM)], enableOnlineChecks: false })
    await expect(apple.verifyTransaction('production', signAppStorePayload({ ...transaction() })))
      .rejects.toMatchObject({ status: VerificationStatus.VERIFICATION_FAILURE })
  })

  it('never accepts unsigned Xcode or local testing data', () => {
    expect(claimedAppStoreEnvironment(signAppStorePayload({ ...transaction({ environment: 'Xcode' }) }), 'transaction')).toBeNull()
    expect(claimedAppStoreEnvironment(signAppStorePayload({ ...transaction({ environment: 'LocalTesting' }) }), 'transaction')).toBeNull()
    expect(claimedAppStoreEnvironment('not-a-jws', 'transaction')).toBeNull()
  })

  it('verifies a notification for this app', async () => {
    const signed = signAppStorePayload({
      notificationType: 'DID_RENEW',
      notificationUUID: 'b6a3c1f4-0000-4000-8000-000000000001',
      version: '2.0',
      signedDate: now,
      data: { environment: 'Production', bundleId: 'com.example.pulpo', appAppleId: 1234567890, status: 1 },
    })
    expect(claimedAppStoreEnvironment(signed, 'notification')).toBe('production')
    await expect(gateway.verifyNotification('production', signed)).resolves.toMatchObject({ notificationType: 'DID_RENEW' })
  })

  it('reports retryable verification failures as unavailable', () => {
    expect(appStoreVerificationError(new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE)))
      .toMatchObject({ statusCode: 503, code: 'app_store_unavailable' })
    expect(appStoreVerificationError(new VerificationException(VerificationStatus.VERIFICATION_FAILURE)))
      .toMatchObject({ statusCode: 400, code: 'invalid_app_store_transaction' })
  })
})
