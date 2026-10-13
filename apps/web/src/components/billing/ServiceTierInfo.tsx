import { Check, Circle } from 'lucide-react'
import { nextUsageTierHint, type DailySpendSummary, type UsageTier } from '@/lib/billing'
import { formatBalance, formatHeadlinePrice } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { activeLocale, ui } from '@/i18n/ui'

const DAY_MS = 24 * 60 * 60 * 1_000
const usd = (micros: number) => formatBalance(micros / 1_000_000)

export function ServiceTierDialog({ open, onOpenChange, daily, tiers }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  daily: DailySpendSummary
  tiers: UsageTier[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{ui("Service tiers")}</DialogTitle>
          <DialogDescription>{ui("Your service tier caps how much you can use each day across plan usage and credits. Tiers go up automatically as your payment history grows.")}</DialogDescription>
        </DialogHeader>
        <ServiceTierInfo daily={daily} tiers={tiers} />
      </DialogContent>
    </Dialog>
  )
}

export function ServiceTierInfo({ daily, tiers, now = Date.now() }: { daily: DailySpendSummary; tiers: UsageTier[]; now?: number }) {
  const hint = nextUsageTierHint(daily, now)
  return (
    <div className="space-y-6 py-2">
      <div className="rounded-lg border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-sm font-semibold">{daily.limitOverridden ? ui("Custom limit") : ui("Tier {{tier}}", { tier: daily.tier })}</div>
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
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{ui("Resets")} {new Date(daily.resetsAt).toLocaleString(activeLocale(), { hour: 'numeric', minute: '2-digit' })}</span>
          {daily.pendingMicros > 0 && <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />{usd(daily.pendingMicros)} {ui("reserved")}</span>}
        </div>
        {daily.limitOverridden
          ? <p className="mt-3 text-sm text-muted-foreground">{ui("An admin set a custom daily limit for your account.")}</p>
          : hint && <p className="mt-3 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0 lg:divide-x">
        {tiers.map((tier, index) => (
          <TierColumn key={index} index={index} tier={tier} daily={daily} now={now} last={index === tiers.length - 1} />
        ))}
      </div>
    </div>
  )
}

function TierColumn({ index, tier, daily, now, last }: { index: number; tier: UsageTier; daily: DailySpendSummary; now: number; last: boolean }) {
  const current = !daily.limitOverridden && index === daily.tier
  const firstPaidAt = daily.firstPaidAt ? Date.parse(daily.firstPaidAt) : null
  const requirements = tier.minPaidCents === 0 && tier.minDaysSinceFirstPayment === 0
    ? [{ label: ui("No payment needed"), met: true }]
    : [
      ...(tier.minPaidCents > 0 ? [{ label: ui("{{amount}} paid", { amount: formatBalance(tier.minPaidCents / 100) }), met: daily.paidCents >= tier.minPaidCents }] : []),
      ...(tier.minDaysSinceFirstPayment > 0 ? [{
        label: ui("{{days}} days since your first payment", { days: tier.minDaysSinceFirstPayment }),
        met: firstPaidAt !== null && now - firstPaidAt >= tier.minDaysSinceFirstPayment * DAY_MS,
      }] : []),
    ]
  return (
    <div className={cn('flex flex-col', index === 0 ? 'lg:pr-5' : last ? 'lg:pl-5' : 'lg:px-5')} aria-current={current ? 'true' : undefined}>
      <div>
        <Badge variant={current ? 'secondary' : 'outline'} className={current ? 'border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : undefined}>
          {ui("Tier {{tier}}", { tier: index })}
        </Badge>
      </div>
      <div className="mt-4 text-2xl font-semibold">{formatHeadlinePrice(tier.dailyLimitMicros / 1_000_000)} <span className="text-sm font-normal text-muted-foreground">{ui("/ day")}</span></div>
      <div className="mt-5 flex-1 space-y-3 text-sm">
        {requirements.map((requirement) => (
          <div key={requirement.label} className={cn('flex items-start gap-2', !requirement.met && 'text-muted-foreground')}>
            {requirement.met
              ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label={ui("Met")} />
              : <Circle className="mt-0.5 size-4 shrink-0" aria-label={ui("Not met yet")} />}
            {requirement.label}
          </div>
        ))}
      </div>
      {current && <Button className="mt-6 w-full" variant="outline" disabled>{ui("Current tier")}</Button>}
    </div>
  )
}
