import { formatUsd } from '@/lib/format'

export type SubscriptionCoverageStatus = 'full' | 'partial' | 'none'

export interface SubscriptionCoverageDetails {
  status: SubscriptionCoverageStatus
  coveredUsd: number
  chargedUsd: number
}

export function subscriptionCoverageDetails(
  costUsd: number,
  subscriptionCoveredUsd: number,
): SubscriptionCoverageDetails {
  if (costUsd <= 0 || subscriptionCoveredUsd <= 0) {
    return { status: 'none', coveredUsd: 0, chargedUsd: Math.max(0, costUsd) }
  }

  const coveredUsd = Math.min(costUsd, subscriptionCoveredUsd)
  return {
    status: coveredUsd >= costUsd ? 'full' : 'partial',
    coveredUsd,
    chargedUsd: Math.max(0, costUsd - coveredUsd),
  }
}

export function subscriptionCoverageLabel(
  details: SubscriptionCoverageDetails,
  personal: boolean,
): string | null {
  if (details.status === 'none') return null
  const subscription = personal ? 'your subscription' : 'subscription'
  if (details.status === 'full') {
    return `Covered by ${subscription} · ${formatUsd(details.chargedUsd)} charged to balance`
  }
  return `${formatUsd(details.coveredUsd)} covered by ${subscription} · ${formatUsd(details.chargedUsd)} charged to balance`
}
