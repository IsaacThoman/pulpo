import type { BillingSummary, CustomLimitSummary } from '@/lib/billing'
import { formatBalance } from '@/lib/format'
import { cn } from '@/lib/utils'
import { activeLocale, ui } from '@/i18n/ui'

type UsageLimit = NonNullable<BillingSummary['weekly'] | BillingSummary['fiveHour'] | BillingSummary['shared']> | CustomLimitSummary

const NO_CUSTOM_LIMITS: CustomLimitSummary[] = []

interface SubscriptionUsageBarsProps {
  weekly: BillingSummary['weekly']
  fiveHour: BillingSummary['fiveHour']
  /** Shown only to Fat subscribers; not extra usage, just the part of weekly usage pool members can draw on. */
  shared?: BillingSummary['shared']
  sharedWeeklyPercent?: number
  /** Admin-defined limits that cover this account. */
  custom?: CustomLimitSummary[]
  compact?: boolean
  className?: string
}

export function SubscriptionUsageBars({ weekly, fiveHour, shared = null, sharedWeeklyPercent, custom = NO_CUSTOM_LIMITS, compact = false, className }: SubscriptionUsageBarsProps) {
  if (!weekly && !fiveHour && !shared && !custom.length) return null

  return (
    <div className={cn(compact ? 'space-y-2.5' : 'space-y-4', className)}>
      {weekly && <SubscriptionUsageBar label={ui("Weekly usage")} limit={weekly} compact={compact} showResetDate />}
      {fiveHour && <SubscriptionUsageBar label={ui("5-hour usage")} limit={fiveHour} compact={compact} />}
      {shared && <SubscriptionUsageBar
        label={ui("Shared usage")}
        limit={shared}
        compact={compact}
        showResetDate
        hint={sharedWeeklyPercent === undefined ? undefined : ui("Pool members can use up to {{percent}}% of your weekly usage", { percent: sharedWeeklyPercent })}
      />}
      {custom.map((limit) => <SubscriptionUsageBar
        key={limit.id}
        label={limit.name}
        limit={limit}
        compact={compact}
        showResetDate={limit.period === 'weekly'}
        hint={[
          limit.models.length ? ui("Applies to {{models}}", { models: limit.models.join(', ') }) : null,
          limit.poolSharePercent ? ui("Pool members can use up to {{percent}}% of this limit", { percent: limit.poolSharePercent }) : null,
        ].filter(Boolean).join(' · ') || undefined}
        resetNote={limit.period === 'five_hour' ? ui("Rolling 5-hour window") : undefined}
      />)}
    </div>
  )
}

export function SubscriptionUsageBar({ label, limit, compact, showResetDate = false, hint, resetNote }: { label: string; limit: UsageLimit; compact: boolean; showResetDate?: boolean; hint?: string; resetNote?: string }) {
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
        {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
        {limit.pendingMicros > 0 && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />{formatBalance(limit.pendingMicros / 1_000_000)} {ui("reserved")}</div>}
        <div className="mt-1.5 text-xs text-muted-foreground">{resetNote ?? (limit.resetsAt
          ? <>{ui("Resets")} {new Date(limit.resetsAt).toLocaleString(activeLocale(), showResetDate
            ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
            : { hour: 'numeric', minute: '2-digit' })}</>
          : ui("Starts on first use"))}</div>
      </>}
    </div>
  )
}
