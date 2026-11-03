import { apiRequest } from './api'
import { formatBytes } from './attachments'
import { chargeCentsForCredits } from './billing-pricing'
import { formatBalance, formatDate } from './format'
import { openExternalUrl } from './runtime'
import { ui } from '@/i18n/ui'

export type BillingPlan = 'baby' | 'eight' | 'fat'

export type BillingProvider = 'stripe' | 'app_store'

/** Apple's page for managing App Store subscriptions; it opens the App Store on Apple devices. */
export const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'

export type AutoTopUpState = 'off' | 'active' | 'limit_reached' | 'payment_failed' | 'payment_method_removed'

export interface AutoTopUpSettings {
  enabled: boolean
  thresholdCents: number
  amountCents: number
  monthlyLimitCents: number
}

export interface AutoTopUpSummary {
  enabled: boolean
  state: AutoTopUpState
  thresholdCents: number | null
  amountCents: number | null
  monthlyLimitCents: number | null
  /** Automatic charges before tax this UTC month. */
  monthSpentCents: number
  monthResetsAt: string
  paymentMethod: { brand: string | null; last4: string | null } | null
  lastAttempt: {
    status: string
    creditCents: number
    failureMessage: string | null
    createdAt: string
  } | null
}

export interface UsageTier {
  minPaidCents: number
  minDaysSinceFirstPayment: number
  dailyLimitMicros: number
}

export interface DailySpendSummary {
  tier: number
  /** An admin set this account's daily limit. */
  limitOverridden: boolean
  limitMicros: number
  spentMicros: number
  pendingMicros: number
  remainingMicros: number
  remainingPercentage: number
  availableBarPercentage: number
  pendingBarPercentage: number
  resetsAt: string
  /** Lifetime payments before tax, net of refunds. */
  paidCents: number
  firstPaidAt: string | null
  next: {
    tier: number
    dailyLimitMicros: number
    remainingPaidCents: number
    minDaysSinceFirstPayment: number
    /** When the waiting period ends; null before the first payment or when there is none. */
    availableAt: string | null
  } | null
}

export type CustomLimitPeriod = 'five_hour' | 'daily' | 'weekly'

/** An admin-defined allowance this account spends before plan usage and credits. */
export interface CustomLimitSummary {
  id: string
  name: string
  period: CustomLimitPeriod
  /** Share of the allowance pool members can draw on. */
  sharePercent?: number
  /** False when it funds only model usage, not tools, workspace time, or background tasks. */
  coversExtras?: boolean
  /** Names of the models the limit covers; empty when it covers every model. */
  models: string[]
  remainingPercentage: number
  availableBarPercentage: number
  pendingMicros: number
  pendingBarPercentage: number
  /** Null for the rolling five-hour window. */
  resetsAt: string | null
}

export interface BillingSummary {
  plan: BillingPlan
  planOverridden: boolean
  balanceMicros: number
  balancePendingMicros: number
  availableBalanceMicros: number
  poolBalanceMicros: number | null
  poolBalancePendingMicros: number | null
  availablePoolBalanceMicros: number | null
  weekly: {
    remainingPercentage: number
    availableBarPercentage: number
    pendingMicros: number
    pendingBarPercentage: number
    resetsAt: string
  } | null
  fiveHour: {
    remainingPercentage: number
    availableBarPercentage: number
    pendingMicros: number
    pendingBarPercentage: number
    resetsAt: string | null
  } | null
  /** How much of this Fat subscriber's weekly usage pool members can still draw on; null when not sharing. */
  shared: {
    remainingPercentage: number
    availableBarPercentage: number
    pendingMicros: number
    pendingBarPercentage: number
    resetsAt: string | null
  } | null
  /** Share of Fat weekly usage that pool members may draw on. */
  sharedWeeklyPercent: number
  /** Null when the account has no daily cap. */
  daily: DailySpendSummary | null
  /** Older servers omit custom limits. */
  customLimits?: CustomLimitSummary[]
  usageTiers: UsageTier[]
  onHold: boolean
  /** Admin-configured file storage included with each plan. */
  planStorageLimitBytes: Record<BillingPlan, number>
  autoTopUp: AutoTopUpSummary
  subscription: {
    /** Older servers omit it; their subscriptions are all Stripe. */
    provider?: BillingProvider
    /** Plan whose benefits apply now. */
    plan: 'eight' | 'fat'
    /** Plan the next renewal bills after a downgrade, or null when unchanged. */
    pendingPlan: 'eight' | 'fat' | null
    status: string
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
  } | null
  /** An App Store subscription will keep renewing, which deleting the account does not stop. */
  appStoreSubscriptionRenews?: boolean
  payments: Array<{
    id: string
    provider?: BillingProvider
    kind: 'credits' | 'subscription'
    /** Charged by an automatic top-up rather than a checkout. */
    automatic: boolean
    plan: 'eight' | 'fat' | null
    requestedCreditCents: number | null
    amountCents: number
    taxCents: number
    status: string
    createdAt: string
  }>
}

export function fetchBillingSummary(): Promise<BillingSummary> {
  return apiRequest<BillingSummary>('/api/billing/summary')
}

/** Opens the payment provider's portal, where a subscription is managed. */
export async function openBillingPortal(): Promise<void> {
  const result = await apiRequest<{ url: string }>('/api/billing/portal', { method: 'POST' })
  await openExternalUrl(result.url)
}

export const AUTO_TOP_UP_MIN_AMOUNT_CENTS = 500
export const AUTO_TOP_UP_MAX_AMOUNT_CENTS = 50_000
export const AUTO_TOP_UP_MAX_THRESHOLD_CENTS = 50_000
export const AUTO_TOP_UP_MAX_MONTHLY_LIMIT_CENTS = 500_000

export function saveAutoTopUpSettings(settings: AutoTopUpSettings): Promise<AutoTopUpSummary> {
  return apiRequest<AutoTopUpSummary>('/api/billing/auto-top-up', { method: 'PUT', body: settings })
}

/** Opens a card-only checkout; `enableAutoTopUp` turns auto top-up on once the card is saved. */
export function startPaymentMethodCheckout(enableAutoTopUp: boolean): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/api/billing/checkouts/payment-method', {
    method: 'POST', body: { idempotencyKey: crypto.randomUUID(), enableAutoTopUp },
  })
}

export function removeAutoTopUpPaymentMethod(): Promise<AutoTopUpSummary> {
  return apiRequest<AutoTopUpSummary>('/api/billing/payment-method', { method: 'DELETE' })
}

/** Form starting values: the stored settings, or a $5 threshold with a limit of four top-ups. */
export function defaultAutoTopUpSettings(summary: AutoTopUpSummary | undefined, amountCents = 2_500): AutoTopUpSettings {
  const amount = summary?.amountCents ?? amountCents
  return {
    // Opening the settings is a request to use them, including after a failure.
    enabled: true,
    thresholdCents: summary?.thresholdCents ?? 500,
    amountCents: amount,
    monthlyLimitCents: summary?.monthlyLimitCents ?? Math.min(AUTO_TOP_UP_MAX_MONTHLY_LIMIT_CENTS, amount * 4),
  }
}

/** Mirrors the server's validation so the form can explain problems before saving. */
export function autoTopUpSettingsError(settings: {
  thresholdCents: number | null
  amountCents: number | null
  monthlyLimitCents: number | null
}): string | null {
  if (settings.thresholdCents === null || settings.thresholdCents > AUTO_TOP_UP_MAX_THRESHOLD_CENTS) {
    return ui("Enter a threshold between $0.00 and $500.00.")
  }
  if (settings.amountCents === null || settings.amountCents < AUTO_TOP_UP_MIN_AMOUNT_CENTS || settings.amountCents > AUTO_TOP_UP_MAX_AMOUNT_CENTS) {
    return ui("Enter an amount between $5.00 and $500.00.")
  }
  if (settings.monthlyLimitCents === null || settings.monthlyLimitCents > AUTO_TOP_UP_MAX_MONTHLY_LIMIT_CENTS) {
    return ui("Enter a monthly limit up to $5,000.00.")
  }
  if (settings.monthlyLimitCents < chargeCentsForCredits(settings.amountCents)) {
    return ui("The monthly limit must cover at least one top-up, including the platform fee.")
  }
  return null
}

export function paymentMethodLabel(paymentMethod: { brand: string | null; last4: string | null }): string {
  const brand = paymentMethod.brand
    ? paymentMethod.brand === 'amex' ? 'Amex' : paymentMethod.brand.charAt(0).toUpperCase() + paymentMethod.brand.slice(1)
    : ui("Card")
  return paymentMethod.last4 ? `${brand} •••• ${paymentMethod.last4}` : brand
}

/** Label for the button that opens the auto top-up settings. */
export function autoTopUpActionLabel(summary: AutoTopUpSummary | undefined): string {
  if (!summary || summary.state !== 'off') return summary ? ui("Auto top-up settings") : ui("Set up auto top-up")
  return summary.thresholdCents === null ? ui("Set up auto top-up") : ui("Turn on auto top-up")
}

function dollars(cents: number): string {
  return formatBalance(cents / 100)
}

/** The monthly limit resets at midnight UTC, so show that calendar day in any time zone. */
function utcCalendarDay(iso: string): number {
  const date = new Date(iso)
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime()
}

/** Auto top-up status under the credit balance, with monthly usage on its own line, or null while it is off. */
export function autoTopUpStatusLine(summary: AutoTopUpSummary): { text: string; usage?: string; tone: 'muted' | 'attention' | 'error' } | null {
  const usage = summary.monthlyLimitCents === null
    ? undefined
    : ui("{{spent}} of {{limit}} used this month", { spent: dollars(summary.monthSpentCents), limit: dollars(summary.monthlyLimitCents) })
  switch (summary.state) {
    case 'active':
      if (summary.thresholdCents === null || summary.amountCents === null) return null
      return {
        text: ui("Auto top-up adds {{amount}} when your balance falls below {{threshold}}", { amount: dollars(summary.amountCents), threshold: dollars(summary.thresholdCents) }),
        usage,
        tone: 'muted',
      }
    case 'limit_reached':
      return { text: ui("Auto top-up paused until {{date}}", { date: formatDate(utcCalendarDay(summary.monthResetsAt)) }), usage, tone: 'muted' }
    case 'payment_failed':
      return {
        text: ui("Auto top-up turned off: {{reason}}", { reason: summary.lastAttempt?.failureMessage ?? ui("your card couldn't be charged.") }),
        tone: 'error',
      }
    case 'payment_method_removed':
      return { text: ui("Auto top-up turned off because your saved card was removed."), tone: 'attention' }
    default:
      return null
  }
}

/** The plan is billed by Apple, so it can only be changed from the iOS app or Apple account settings. */
export function billedByAppStore(summary: Pick<BillingSummary, 'subscription'> | undefined): boolean {
  return summary?.subscription?.provider === 'app_store'
}

/** Status line for an App Store subscription. Apple sets the price, so it is not shown. */
export function appStoreSubscriptionSubtitle(subscription: NonNullable<BillingSummary['subscription']>): string {
  const date = subscription.currentPeriodEnd ? formatDate(Date.parse(subscription.currentPeriodEnd)) : null
  if (subscription.status === 'past_due') return date ? ui("App Store · payment past due · access through {{date}}", { date }) : ui("App Store · payment past due")
  if (subscription.cancelAtPeriodEnd) return date ? ui("App Store · ends {{date}}", { date }) : ui("App Store · ends at the end of this period")
  if (subscription.pendingPlan && subscription.pendingPlan !== subscription.plan) {
    return date
      ? ui("App Store · switches to {{plan}} on {{date}}", { plan: billingPlanName(subscription.pendingPlan), date })
      : ui("App Store · switches to {{plan}} at renewal", { plan: billingPlanName(subscription.pendingPlan) })
  }
  return date ? ui("App Store · renews {{date}}", { date }) : ui("Billed through the App Store")
}

export function managedBillingPlan(summary: Pick<BillingSummary, 'subscription'>): BillingPlan {
  return summary.subscription?.plan ?? 'baby'
}

/** Plan storage reads as marketing copy, so whole sizes drop the trailing `.0`. */
export function formatPlanStorage(bytes: number): string {
  return formatBytes(bytes).replace(/\.0 /, ' ')
}

export function billingPlanName(plan: BillingPlan): string {
  if (plan === 'eight') return 'Pulpo Eight'
  if (plan === 'fat') return 'Pulpo Fat'
  return 'Pulpo Baby'
}

/** Tier word shown after the Pulpo wordmark. */
export function billingPlanTier(plan: BillingPlan): string {
  if (plan === 'eight') return 'Eight'
  if (plan === 'fat') return 'Fat'
  return 'Baby'
}

export function pendingBillingPlan(summary: Pick<BillingSummary, 'subscription'>): BillingPlan | null {
  const pending = summary.subscription?.pendingPlan ?? null
  return pending && pending !== summary.subscription?.plan ? pending : null
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'paid': return ui("Paid")
    case 'refunded': return ui("Refunded")
    default: return ui("Unknown")
  }
}

export function planChoiceLabel(
  plan: BillingPlan,
  current: BillingPlan,
  cancelAtPeriodEnd: boolean,
  pendingPlan: BillingPlan | null = null,
): string {
  const scheduledSwitch = pendingPlan !== null && pendingPlan !== current
  if (plan === 'baby') return cancelAtPeriodEnd || current === 'baby' ? 'Current plan' : 'Cancel plan'
  if (plan === current) {
    if (cancelAtPeriodEnd) return `Renew for $${plan === 'eight' ? 8 : 24}/month`
    return scheduledSwitch ? ui("Keep $24/month") : 'Current plan'
  }
  if (current === 'baby') return `Subscribe for $${plan === 'eight' ? 8 : 24}/month`
  if (cancelAtPeriodEnd) return `Renew for $${plan === 'eight' ? 8 : 24}/month`
  if (scheduledSwitch && plan === pendingPlan) return ui("Switches at renewal")
  if (plan === 'fat') return ui("Upgrade for $24/month")
  return ui("Downgrade to $8/month")
}

export function planChoiceDisabled(
  plan: BillingPlan,
  current: BillingPlan,
  cancelAtPeriodEnd: boolean,
  pendingPlan: BillingPlan | null = null,
): boolean {
  const scheduledSwitch = pendingPlan !== null && pendingPlan !== current
  if (plan === current) return !cancelAtPeriodEnd && !scheduledSwitch
  if (plan === 'baby') return cancelAtPeriodEnd
  if (scheduledSwitch && plan === pendingPlan) return !cancelAtPeriodEnd
  return false
}

export function nextUsageTierHint(daily: DailySpendSummary, now = Date.now()): string | null {
  const next = daily.next
  if (!next || daily.limitOverridden) return null
  const values = { tier: next.tier, limit: formatBalance(next.dailyLimitMicros / 1_000_000), amount: formatBalance(next.remainingPaidCents / 100) }
  const waitUntil = next.availableAt && Date.parse(next.availableAt) > now ? formatDate(Date.parse(next.availableAt)) : null
  const waitsForFirstPayment = next.minDaysSinceFirstPayment > 0 && !next.availableAt
  if (next.remainingPaidCents > 0) {
    if (waitUntil) return ui("Pay {{amount}} more and wait until {{date}} to reach tier {{tier}} ({{limit}} per day).", { ...values, date: waitUntil })
    if (waitsForFirstPayment) return ui("Pay {{amount}} more and wait {{days}} days after your first payment to reach tier {{tier}} ({{limit}} per day).", { ...values, days: next.minDaysSinceFirstPayment })
    return ui("Pay {{amount}} more to reach tier {{tier}} ({{limit}} per day).", values)
  }
  if (waitUntil) return ui("You reach tier {{tier}} ({{limit}} per day) on {{date}}.", { ...values, date: waitUntil })
  return null
}
