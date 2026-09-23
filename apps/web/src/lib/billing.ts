import { apiRequest } from './api'
import { chargeCentsForCredits } from './billing-pricing'
import { ui } from '@/i18n/ui'

export type BillingPlan = 'baby' | 'eight' | 'fat'

export type AutoTopUpState = 'off' | 'needs_payment_method' | 'active' | 'limit_reached' | 'payment_failed' | 'payment_method_removed'

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
  onHold: boolean
  autoTopUp: AutoTopUpSummary
  subscription: {
    /** Plan whose benefits apply now. */
    plan: 'eight' | 'fat'
    /** Plan the next renewal bills after a downgrade, or null when unchanged. */
    pendingPlan: 'eight' | 'fat' | null
    status: string
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
  } | null
  payments: Array<{
    id: string
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

export const AUTO_TOP_UP_MIN_AMOUNT_CENTS = 500
export const AUTO_TOP_UP_MAX_AMOUNT_CENTS = 50_000
export const AUTO_TOP_UP_MAX_THRESHOLD_CENTS = 50_000
export const AUTO_TOP_UP_MAX_MONTHLY_LIMIT_CENTS = 500_000

export function saveAutoTopUpSettings(settings: AutoTopUpSettings): Promise<AutoTopUpSummary> {
  return apiRequest<AutoTopUpSummary>('/api/billing/auto-top-up', { method: 'PUT', body: settings })
}

export function startPaymentMethodCheckout(): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/api/billing/checkouts/payment-method', {
    method: 'POST', body: { idempotencyKey: crypto.randomUUID() },
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

export function autoTopUpStateLabel(state: AutoTopUpState): string {
  switch (state) {
    case 'active': return ui("On")
    case 'limit_reached': return ui("Monthly limit reached")
    case 'needs_payment_method': return ui("Needs a card")
    case 'payment_failed': return ui("Payment failed")
    case 'payment_method_removed': return ui("Card removed")
    default: return ui("Off")
  }
}

export function managedBillingPlan(summary: Pick<BillingSummary, 'subscription'>): BillingPlan {
  return summary.subscription?.plan ?? 'baby'
}

export function billingPlanName(plan: BillingPlan): string {
  if (plan === 'eight') return 'Pulpo Eight'
  if (plan === 'fat') return 'Le Pulpo Fat'
  return 'Pulpo Baby'
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
