import { apiRequest } from './api'

export type BillingPlan = 'baby' | 'eight' | 'fat'

export interface BillingSummary {
  plan: BillingPlan
  balanceMicros: number
  weekly: { remainingPercentage: number; resetsAt: string } | null
  onHold: boolean
  subscription: {
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
  if (plan === current) return 'Current plan'
  if (plan === 'baby') return cancelAtPeriodEnd ? 'Switch scheduled' : 'Switch to Baby'
  if (current === 'baby') return `Subscribe for $${plan === 'eight' ? 8 : 24}/month`
  if (plan === 'fat') return 'Upgrade for $24/month'
  return 'Included in Fat'
}

export function planChoiceDisabled(plan: BillingPlan, current: BillingPlan, cancelAtPeriodEnd: boolean): boolean {
  if (plan === current) return true
  if (plan === 'baby') return cancelAtPeriodEnd
  if (plan === 'eight' && current === 'fat') return true
  return false
}
