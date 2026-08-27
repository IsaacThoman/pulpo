import { apiRequest } from './api'
import { ui } from '@/i18n/ui'

export type BillingPlan = 'baby' | 'eight' | 'fat'

export interface BillingSummary {
  plan: BillingPlan
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
    plan: 'eight' | 'fat'
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

export function billingPlanName(plan: BillingPlan): string {
  if (plan === 'eight') return 'Pulpo Eight'
  if (plan === 'fat') return 'Le Pulpo Fat'
  return 'Pulpo Baby'
}

export function planChoiceLabel(plan: BillingPlan, current: BillingPlan, cancelAtPeriodEnd: boolean): string {
  if (plan === 'baby') return cancelAtPeriodEnd || current === 'baby' ? 'Current plan' : 'Cancel plan'
  if (plan === current) return cancelAtPeriodEnd ? `Renew for $${plan === 'eight' ? 8 : 24}/month` : 'Current plan'
  if (current === 'baby') return `Subscribe for $${plan === 'eight' ? 8 : 24}/month`
  if (cancelAtPeriodEnd) return `Renew for $${plan === 'eight' ? 8 : 24}/month`
  if (plan === 'fat') return ui("Upgrade for $24/month")
  return ui("Downgrade to $8/month")
}

export function planChoiceDisabled(plan: BillingPlan, current: BillingPlan, cancelAtPeriodEnd: boolean): boolean {
  if (plan === current) return !cancelAtPeriodEnd
  if (plan === 'baby') return cancelAtPeriodEnd
  return false
}
