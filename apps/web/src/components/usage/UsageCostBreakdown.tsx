import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SubscriptionCoverageCost } from './SubscriptionCoverageCost'
import { subscriptionCoverageDetails, subscriptionCoverageLabel } from './subscription-coverage'

export function UsageCostBreakdown({
  costUsd,
  inferenceReferenceUsd,
  subscriptionCoveredUsd,
  personal = false,
  highlightCoverage = true,
}: {
  costUsd: number
  inferenceReferenceUsd: number
  subscriptionCoveredUsd: number
  personal?: boolean
  highlightCoverage?: boolean
}) {
  if (inferenceReferenceUsd <= 0) {
    return <SubscriptionCoverageCost
      costUsd={costUsd}
      subscriptionCoveredUsd={subscriptionCoveredUsd}
      personal={personal}
      highlightCoverage={highlightCoverage}
    />
  }

  const combinedUsd = inferenceReferenceUsd + costUsd
  const formattedCombined = formatUsd(combinedUsd)
  const formattedReference = formatUsd(inferenceReferenceUsd)
  const formattedPulpoCost = formatUsd(costUsd)
  const coverage = subscriptionCoverageDetails(costUsd, subscriptionCoveredUsd)
  const coverageLabel = subscriptionCoverageLabel(coverage, personal)
  const accessibleBreakdown = uit`${formattedCombined} · ${ui("API equivalent")}: ${formattedReference} · ${ui("Pulpo usage")}: ${formattedPulpoCost}${coverageLabel ? ` · ${coverageLabel}` : ''}`

  return <Tooltip>
    <TooltipTrigger asChild>
      <span
        tabIndex={0}
        aria-label={accessibleBreakdown}
        data-inference-reference-cost
        className={cn(
          'cursor-help whitespace-nowrap rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          highlightCoverage && 'text-violet-700 dark:text-violet-300',
        )}
      >
        {formattedCombined}
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 tabular-nums">
        <span>{ui("API equivalent")}</span>
        <span className="text-right">{formattedReference}</span>
        <span>{ui("Pulpo usage")}</span>
        <span className="text-right">{formattedPulpoCost}</span>
        {coverageLabel && <span className="col-span-2 border-t border-primary-foreground/20 pt-1">{coverageLabel}</span>}
      </div>
    </TooltipContent>
  </Tooltip>
}
