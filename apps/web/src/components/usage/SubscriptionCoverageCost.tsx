import { formatUsd } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { subscriptionCoverageDetails, subscriptionCoverageLabel } from './subscription-coverage'

export function SubscriptionCoverageCost({
  costUsd,
  subscriptionCoveredUsd,
  personal = false,
}: {
  costUsd: number
  subscriptionCoveredUsd: number
  personal?: boolean
}) {
  const details = subscriptionCoverageDetails(costUsd, subscriptionCoveredUsd)
  const label = subscriptionCoverageLabel(details, personal)
  const formattedCost = formatUsd(costUsd)

  if (!label) return <span>{formattedCost}</span>

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${formattedCost} · ${label}`}
          data-subscription-coverage={details.status}
          className="cursor-help rounded-sm text-violet-700 underline decoration-violet-500/70 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:text-violet-300 dark:decoration-violet-400/70"
        >
          {formattedCost}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
