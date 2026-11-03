import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  Order,
  ProductType,
  SignedDataVerifier,
  Status,
  TransactionReason,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'
import { appStoreBillingEnabled, getConfig, type Config } from '../config.js'
import type { AppStoreEnvironment } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { APPLE_ROOT_CA_G3_PEM } from './apple-root-certificates.js'
import { APP_STORE_COMMISSION_BASIS_POINTS, APP_STORE_PLAN_PRICE_CENTS, type PaidBillingPlan } from './plans.js'

export type AppStoreTransaction = JWSTransactionDecodedPayload
export type AppStoreRenewalInfo = JWSRenewalInfoDecodedPayload
export type AppStoreNotification = ResponseBodyV2DecodedPayload

/** The latest state Apple reports for one subscription. */
export type AppStoreSubscriptionStatus = {
  status: Status | number
  signedTransactionInfo: string
  signedRenewalInfo: string | null
}

export interface AppStoreGateway {
  verifyTransaction(environment: AppStoreEnvironment, signedTransaction: string): Promise<AppStoreTransaction>
  verifyRenewalInfo(environment: AppStoreEnvironment, signedRenewalInfo: string): Promise<AppStoreRenewalInfo>
  verifyNotification(environment: AppStoreEnvironment, signedPayload: string): Promise<AppStoreNotification>
  /** Apple's current status for a subscription, or null if Apple has none. */
  subscriptionStatus(environment: AppStoreEnvironment, originalTransactionId: string): Promise<AppStoreSubscriptionStatus | null>
  /** Signed subscription transactions for the subscription a transaction belongs to, oldest first. */
  transactionHistory(environment: AppStoreEnvironment, transactionId: string, since: Date): AsyncGenerator<string>
  /** Asks Apple to send a TEST notification to the environment's notification URL. */
  requestTestNotification(environment: AppStoreEnvironment): Promise<void>
}

const APPLE_ENVIRONMENTS: Record<AppStoreEnvironment, Environment> = {
  production: Environment.PRODUCTION,
  sandbox: Environment.SANDBOX,
}

/** Maps Apple's environment name to ours. Xcode and local testing data is unsigned and never accepted. */
export function appStoreEnvironment(value: string | undefined | null): AppStoreEnvironment | null {
  if (value === Environment.PRODUCTION) return 'production'
  if (value === Environment.SANDBOX) return 'sandbox'
  return null
}

/** Environments whose purchases this server accepts; empty when App Store billing is off. */
export function acceptedAppStoreEnvironments(config: Config = getConfig()): AppStoreEnvironment[] {
  return appStoreBillingEnabled(config) ? config.APP_STORE_ENVIRONMENTS : []
}

export function appStorePlanForProduct(productId: string | null | undefined, config: Config = getConfig()): PaidBillingPlan | null {
  if (!productId) return null
  if (productId === config.APP_STORE_EIGHT_PRODUCT_ID) return 'eight'
  if (productId === config.APP_STORE_FAT_PRODUCT_ID) return 'fat'
  return null
}

function decodeSegment(jws: string): Record<string, unknown> | null {
  const payload = jws.split('.')[1]
  if (!payload) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * The environment a signed transaction or notification claims, read before verification only to
 * pick the verifier. The verifier then rejects data whose environment does not match it.
 */
export function claimedAppStoreEnvironment(jws: string, kind: 'transaction' | 'notification'): AppStoreEnvironment | null {
  const payload = decodeSegment(jws)
  const data = kind === 'notification' ? payload?.data : payload
  const environment = data && typeof data === 'object' ? (data as { environment?: unknown }).environment : undefined
  return typeof environment === 'string' ? appStoreEnvironment(environment) : null
}

/** Turns a verification failure into an API error: retryable failures are 503, the rest 400. */
export function appStoreVerificationError(error: unknown): AppError {
  if (error instanceof VerificationException && error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
    return new AppError(503, 'app_store_unavailable', 'The App Store could not be reached. Try again shortly.')
  }
  return new AppError(400, 'invalid_app_store_transaction', 'The App Store transaction could not be verified')
}

export function isMissingAppStoreResource(error: unknown): boolean {
  return error instanceof APIException && error.httpStatusCode === 404
}

/** The subscription's state in Pulpo's terms, from Apple's status and the latest transaction. */
export type AppStoreSubscriptionState = {
  plan: PaidBillingPlan
  paidPlan: PaidBillingPlan
  status: 'active' | 'past_due' | 'canceled'
  paidThrough: Date | null
  cancelAtPeriodEnd: boolean
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}

function appleDate(value: number | undefined): Date | null {
  return typeof value === 'number' ? new Date(value) : null
}

export function isRefundedTransaction(transaction: Pick<AppStoreTransaction, 'revocationDate' | 'isUpgraded'>): boolean {
  // An upgrade ends the old transaction early without refunding it.
  return typeof transaction.revocationDate === 'number' && !transaction.isUpgraded
}

/** The status to use when only a transaction is known. */
export function statusFromTransaction(transaction: AppStoreTransaction, now = new Date()): Status {
  if (isRefundedTransaction(transaction)) return Status.REVOKED
  const expiresDate = appleDate(transaction.expiresDate)
  return expiresDate && expiresDate > now ? Status.ACTIVE : Status.EXPIRED
}

/**
 * Maps Apple's subscription status onto a Pulpo subscription row. The current product sets the paid
 * plan and the auto-renew product sets the plan, so a downgrade keeps the paid plan until renewal.
 * Grace periods keep access until the grace period ends; billing retry and refunds end it.
 */
export function appStoreSubscriptionState(input: {
  status: Status | number
  transaction: AppStoreTransaction
  renewal?: AppStoreRenewalInfo | null
}, config: Config = getConfig()): AppStoreSubscriptionState | null {
  const paidPlan = appStorePlanForProduct(input.transaction.productId, config)
  if (!paidPlan) return null
  const plan = appStorePlanForProduct(input.renewal?.autoRenewProductId, config) ?? paidPlan
  const expiresDate = appleDate(input.transaction.expiresDate)
  const base = {
    plan,
    paidPlan,
    cancelAtPeriodEnd: input.renewal ? input.renewal.autoRenewStatus === 0 : false,
    currentPeriodStart: appleDate(input.transaction.purchaseDate),
    currentPeriodEnd: expiresDate,
  }
  if (input.status === Status.REVOKED || isRefundedTransaction(input.transaction)) {
    return { ...base, status: 'canceled', paidThrough: null }
  }
  switch (input.status) {
    case Status.ACTIVE:
      return { ...base, status: 'active', paidThrough: expiresDate }
    case Status.BILLING_GRACE_PERIOD: {
      const graceEnds = appleDate(input.renewal?.gracePeriodExpiresDate)
      return { ...base, status: 'past_due', paidThrough: graceEnds && expiresDate && graceEnds > expiresDate ? graceEnds : expiresDate }
    }
    case Status.BILLING_RETRY:
      return { ...base, status: 'past_due', paidThrough: expiresDate }
    default:
      return { ...base, status: 'canceled', paidThrough: expiresDate }
  }
}

/**
 * Order amounts in US cents. Usage tiers and revenue are tracked in dollars, so US purchases use the
 * price Apple charged and other storefronts use the plan's US price. Sandbox purchases cost nothing.
 */
export function appStoreOrderAmounts(transaction: Pick<AppStoreTransaction, 'price' | 'currency' | 'revocationPercentage'>, input: {
  environment: AppStoreEnvironment
  plan: PaidBillingPlan
}): { netCents: number; feeCents: number; refundCents: number } {
  if (input.environment === 'sandbox' || transaction.price === 0) return { netCents: 0, feeCents: 0, refundCents: 0 }
  const netCents = transaction.currency === 'USD' && typeof transaction.price === 'number'
    ? Math.round(transaction.price / 10)
    : APP_STORE_PLAN_PRICE_CENTS[input.plan]
  // Apple reports partial refunds in thousandths of a percent.
  const refundShare = typeof transaction.revocationPercentage === 'number'
    ? Math.min(100_000, Math.max(0, transaction.revocationPercentage)) / 100_000
    : 1
  return {
    netCents,
    feeCents: Math.round(netCents * APP_STORE_COMMISSION_BASIS_POINTS / 10_000),
    refundCents: Math.round(netCents * refundShare),
  }
}

export function appStoreBillingReason(transaction: Pick<AppStoreTransaction, 'transactionReason' | 'transactionId' | 'originalTransactionId'>): string {
  if (transaction.transactionReason === TransactionReason.RENEWAL) return 'subscription_cycle'
  return transaction.transactionId === transaction.originalTransactionId ? 'subscription_create' : 'subscription_update'
}

export function createAppStoreGateway(input: {
  config: Config
  rootCertificates: Buffer[]
  enableOnlineChecks: boolean
}): AppStoreGateway {
  const { config } = input
  const verifiers = new Map<AppStoreEnvironment, SignedDataVerifier>()
  const clients = new Map<AppStoreEnvironment, AppStoreServerAPIClient>()
  const verifier = (environment: AppStoreEnvironment) => {
    let value = verifiers.get(environment)
    if (!value) {
      value = new SignedDataVerifier(
        input.rootCertificates,
        input.enableOnlineChecks,
        APPLE_ENVIRONMENTS[environment],
        config.APP_STORE_BUNDLE_ID!,
        config.APP_STORE_APP_APPLE_ID,
      )
      verifiers.set(environment, value)
    }
    return value
  }
  const client = (environment: AppStoreEnvironment) => {
    let value = clients.get(environment)
    if (!value) {
      value = new AppStoreServerAPIClient(
        config.APP_STORE_PRIVATE_KEY!,
        config.APP_STORE_KEY_ID!,
        config.APP_STORE_ISSUER_ID!,
        config.APP_STORE_BUNDLE_ID!,
        APPLE_ENVIRONMENTS[environment],
      )
      clients.set(environment, value)
    }
    return value
  }
  return {
    verifyTransaction: (environment, signed) => verifier(environment).verifyAndDecodeTransaction(signed),
    verifyRenewalInfo: (environment, signed) => verifier(environment).verifyAndDecodeRenewalInfo(signed),
    verifyNotification: (environment, signed) => verifier(environment).verifyAndDecodeNotification(signed),
    async subscriptionStatus(environment, originalTransactionId) {
      let response
      try {
        response = await client(environment).getAllSubscriptionStatuses(originalTransactionId)
      } catch (error) {
        if (isMissingAppStoreResource(error)) return null
        throw error
      }
      for (const group of response.data ?? []) {
        for (const item of group.lastTransactions ?? []) {
          // Family Sharing can list other subscribers' subscriptions in the same group.
          if (item.originalTransactionId === originalTransactionId && item.signedTransactionInfo && typeof item.status === 'number') {
            return { status: item.status, signedTransactionInfo: item.signedTransactionInfo, signedRenewalInfo: item.signedRenewalInfo ?? null }
          }
        }
      }
      return null
    },
    async *transactionHistory(environment, transactionId, since) {
      let revision: string | null = null
      for (;;) {
        const page = await client(environment).getTransactionHistory(transactionId, revision, {
          productTypes: [ProductType.AUTO_RENEWABLE],
          sort: Order.ASCENDING,
          startDate: since.getTime(),
        })
        yield* page.signedTransactions ?? []
        if (!page.hasMore || !page.revision) return
        revision = page.revision
      }
    },
    async requestTestNotification(environment) {
      await client(environment).requestTestNotification()
    },
  }
}

let gateway: AppStoreGateway | undefined

export function getAppStoreGateway(): AppStoreGateway {
  gateway ??= createAppStoreGateway({
    config: getConfig(),
    rootCertificates: [Buffer.from(APPLE_ROOT_CA_G3_PEM)],
    // Checks certificate revocation with Apple. Tests verify against fixed signing dates instead.
    enableOnlineChecks: getConfig().NODE_ENV === 'production',
  })
  return gateway
}
