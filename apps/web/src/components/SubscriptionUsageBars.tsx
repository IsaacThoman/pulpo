import type { BillingSummary } from '@/lib/billing'
import { formatBalance } from '@/lib/format'
import { cn } from '@/lib/utils'
import { activeLocale, ui } from '@/i18n/ui'

type UsageLimit = NonNullable<BillingSummary['weekly'] | BillingSummary['fiveHour']>

interface SubscriptionUsageBarsProps {
  weekly: BillingSummary['weekly']
  fiveHour: BillingSummary['fiveHour']
  compact?: boolean
  className?: string
}

export function SubscriptionUsageBars({ weekly, fiveHour, compact = false, className }: SubscriptionUsageBarsProps) {
  if (!weekly && !fiveHour) return null

  return (
    <div className={cn(compact ? 'space-y-2.5' : 'space-y-4', className)}>
      {weekly && <SubscriptionUsageBar label={ui("Weekly usage")} limit={weekly} compact={compact} />}
      {fiveHour && <SubscriptionUsageBar label={ui("5-hour usage")} limit={fiveHour} compact={compact} />}
    </div>
  )
}

function SubscriptionUsageBar({ label, limit, compact }: { label: string; limit: UsageLimit; compact: boolean }) {
  return (
    <div>
      <div className="flex justify-between gap-4 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="shrink-0 tabular-nums">{limit.remainingPercentage}{ui("% left")}</span>
      </div>
      <div
        className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={limit.remainingPercentage}
        aria-valuetext={`${limit.remainingPercentage}${ui("% left")}`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-emerald-500" style={{ width: `${limit.availableBarPercentage}%` }} />
        <div className="h-full bg-amber-400 dark:bg-amber-500" style={{ width: `${limit.pendingBarPercentage}%` }} />
      </div>
      {!compact && <>
        {limit.pendingMicros > 0 && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />{formatBalance(limit.pendingMicros / 1_000_000)} {ui("reserved")}</div>}
        <div className="mt-1.5 text-xs text-muted-foreground">{limit.resetsAt
          ? <>{ui("Resets")} {new Date(limit.resetsAt).toLocaleString(activeLocale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</>
          : ui("Starts on first use")}</div>
      </>}
    </div>
  )
}
