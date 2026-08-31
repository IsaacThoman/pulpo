import { formatUsd } from '@/lib/format'
import { ui } from '@/i18n/ui'
import { SubscriptionCoverageCost } from './SubscriptionCoverageCost'

export function UsageCostBreakdown({
  costUsd,
  inferenceReferenceUsd,
  subscriptionCoveredUsd,
  personal = false,
}: {
  costUsd: number
  inferenceReferenceUsd: number
  subscriptionCoveredUsd: number
  personal?: boolean
}) {
  if (inferenceReferenceUsd <= 0) {
    return <SubscriptionCoverageCost
      costUsd={costUsd}
      subscriptionCoveredUsd={subscriptionCoveredUsd}
      personal={personal}
    />
  }
  return <span className="inline-flex flex-col items-end gap-0.5">
    <span
      className="whitespace-nowrap"
      title={ui("Estimated API-equivalent inference value; not charged by Pulpo")}
      data-inference-reference-cost
    >
      {formatUsd(inferenceReferenceUsd)} <span className="text-muted-foreground">{ui("API equivalent")}</span>
    </span>
    <span className="whitespace-nowrap text-muted-foreground">
      <SubscriptionCoverageCost
        costUsd={costUsd}
        subscriptionCoveredUsd={subscriptionCoveredUsd}
        personal={personal}
      /> {ui("Pulpo charge")}
    </span>
  </span>
}
