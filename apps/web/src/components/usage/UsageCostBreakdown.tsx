import type { UsageCostItem } from '@pulpo/contracts'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SubscriptionCoverageCost } from './SubscriptionCoverageCost'
import { subscriptionCoverageDetails, subscriptionCoverageLabel } from './subscription-coverage'
import { usageCostLines, type UsageCostLine } from './usage-cost-items'

export function UsageCostBreakdown({
  costUsd,
  inferenceReferenceUsd,
  subscriptionCoveredUsd,
  items,
  personal = false,
  highlightCoverage = true,
}: {
  costUsd: number
  inferenceReferenceUsd: number
  subscriptionCoveredUsd: number
  /** Itemized charges; events settled before itemization have none. */
  items?: readonly UsageCostItem[] | null
  personal?: boolean
  highlightCoverage?: boolean
}) {
  const itemLines = usageCostLines(items)
  const hasReference = inferenceReferenceUsd > 0
  if (!hasReference && itemLines.length === 0) {
    return <SubscriptionCoverageCost
      costUsd={costUsd}
      subscriptionCoveredUsd={subscriptionCoveredUsd}
      personal={personal}
      highlightCoverage={highlightCoverage}
    />
  }

  const formattedTotal = formatUsd(hasReference ? inferenceReferenceUsd + costUsd : costUsd)
  const coverage = subscriptionCoverageDetails(costUsd, subscriptionCoveredUsd)
  const coverageLabel = subscriptionCoverageLabel(coverage, personal)
  const lines: UsageCostLine[] = [
    ...(hasReference ? [{ amount: formatUsd(inferenceReferenceUsd), label: ui("API equivalent") }] : []),
    ...(itemLines.length ? itemLines : [{ amount: formatUsd(costUsd), label: ui("Pulpo usage") }]),
  ]
  const accessibleBreakdown = [
    formattedTotal,
    ...lines.map((line) => `${line.label}: ${line.amount}`),
    ...(coverageLabel ? [coverageLabel] : []),
  ].join(' · ')

  return <Tooltip>
    <TooltipTrigger asChild>
      <span
        tabIndex={0}
        aria-label={accessibleBreakdown}
        data-usage-cost-breakdown
        {...(hasReference ? { 'data-inference-reference-cost': '' } : {})}
        className={cn(
          'cursor-help whitespace-nowrap rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          hasReference && 'font-medium',
          highlightCoverage && (hasReference || coverageLabel) && 'text-violet-700 dark:text-violet-300',
        )}
      >
        {formattedTotal}
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 tabular-nums">
        {lines.map((line, index) => <div key={index} className="contents">
          <span className="text-right">{line.amount}</span>
          <span>{line.label}</span>
        </div>)}
        {coverageLabel && <span className="col-span-2 border-t border-primary-foreground/20 pt-1">{coverageLabel}</span>}
      </div>
    </TooltipContent>
  </Tooltip>
}
