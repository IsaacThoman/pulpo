import { Info } from 'lucide-react'
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

  return (
    <span className={`inline-flex items-center justify-end gap-1 ${label ? 'text-violet-700 dark:text-violet-300' : ''}`}>
      <span>{formatUsd(costUsd)}</span>
      {label && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              tabIndex={0}
              aria-label={label}
              data-subscription-coverage={details.status}
              className="inline-flex shrink-0 cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}
