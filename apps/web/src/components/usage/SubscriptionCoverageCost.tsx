import { formatUsd } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { subscriptionCoverageDetails, subscriptionCoverageLabel } from './subscription-coverage'
import { uit } from '@/i18n/ui'

export function SubscriptionCoverageCost({
  costUsd,
  subscriptionCoveredUsd,
  personal = false,
  formattedCost,
}: {
  costUsd: number
  subscriptionCoveredUsd: number
  personal?: boolean
  formattedCost?: string
}) {
  const details = subscriptionCoverageDetails(costUsd, subscriptionCoveredUsd)
  const label = subscriptionCoverageLabel(details, personal)
  const displayCost = formattedCost ?? formatUsd(costUsd)

  if (!label) return <span>{displayCost}</span>

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={uit`${displayCost} · ${label}`}
          data-subscription-coverage={details.status}
          className="cursor-help rounded-sm text-violet-700 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:text-violet-300"
        >
          {displayCost}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
