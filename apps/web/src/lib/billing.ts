import { apiRequest } from './api'
import { ui } from '@/i18n/ui'

export type BillingPlan = 'baby' | 'eight' | 'fat'

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
