import { nextUsageTierHint, usageTierRequirement, type DailySpendSummary, type UsageTier } from '@/lib/billing'
import { formatBalance } from '@/lib/format'
import { cn } from '@/lib/utils'
import { activeLocale, ui } from '@/i18n/ui'

const usd = (micros: number) => formatBalance(micros / 1_000_000)

export function DailyUsageLimit({ daily, tiers, className }: { daily: DailySpendSummary; tiers: UsageTier[]; className?: string }) {
  const hint = nextUsageTierHint(daily)
  return (
    <div className={cn('grid gap-6 rounded-xl border p-4 sm:p-5 lg:grid-cols-2', className)}>
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-base font-semibold">{daily.limitOverridden ? ui("Custom limit") : ui("Tier {{tier}}", { tier: daily.tier })}</div>
          <div className="text-xs tabular-nums text-muted-foreground">{ui("{{spent}} of {{limit}} used today", { spent: usd(daily.spentMicros), limit: usd(daily.limitMicros) })}</div>
        </div>
        <div
          className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={ui("Daily usage")}
          aria-valuenow={daily.remainingPercentage}
          aria-valuetext={`${daily.remainingPercentage}${ui("% left")}`}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-emerald-500" style={{ width: `${daily.availableBarPercentage}%` }} />
          <div className="h-full bg-amber-400 dark:bg-amber-500" style={{ width: `${daily.pendingBarPercentage}%` }} />
        </div>
        {daily.pendingMicros > 0 && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />{usd(daily.pendingMicros)} {ui("reserved")}</div>}
        <div className="mt-1.5 text-xs text-muted-foreground">{ui("Resets")} {new Date(daily.resetsAt).toLocaleString(activeLocale(), { hour: 'numeric', minute: '2-digit' })}</div>
        {daily.limitOverridden
          ? <p className="mt-3 text-sm text-muted-foreground">{ui("An admin set a custom daily limit for your account.")}</p>
          : hint && <p className="mt-3 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-1.5 pr-3 text-left font-normal">{ui("Tier")}</th>
            <th className="py-1.5 pr-3 text-left font-normal">{ui("Requirement")}</th>
            <th className="py-1.5 text-right font-normal">{ui("Daily limit")}</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, index) => {
            const current = !daily.limitOverridden && index === daily.tier
            return (
              <tr key={index} className={cn('border-b last:border-0', current && 'font-medium text-foreground')} aria-current={current ? 'true' : undefined}>
                <td className="py-1.5 pr-3 tabular-nums">{index}</td>
                <td className={cn('py-1.5 pr-3', !current && 'text-muted-foreground')}>{usageTierRequirement(tier)}</td>
                <td className="py-1.5 text-right tabular-nums">{usd(tier.dailyLimitMicros)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
