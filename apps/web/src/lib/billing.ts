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
