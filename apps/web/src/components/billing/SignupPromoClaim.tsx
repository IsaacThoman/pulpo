import type { ReactNode } from 'react'
import { CircleCheck, Gift } from 'lucide-react'
import { formatBalance } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { signupPromoResetTime, useSignupPromoClaim, useSignupPromoOffer } from '@/components/layout/signup-promo'

/**
 * The signup promo on the Billing page. Like the chat action, it ignores the banner's
 * dismissal, since it is how a dismissed promo can still be found.
 */
export function SignupPromoClaim({ className }: { className?: string }) {
  const { data: offer } = useSignupPromoOffer()
  const { claim, claiming, claimedMicros, error } = useSignupPromoClaim()

  if (claimedMicros !== null) {
    const amount = formatBalance(claimedMicros / 1_000_000)
    return (
      <div role="status" className={cn('flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-[color-mix(in_oklab,var(--color-emerald-500)_10%,var(--card))] px-3 py-2 text-sm text-foreground', className)}>
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span>{ui("{{amount}} in credits was added to your balance.", { amount })}</span>
      </div>
    )
  }
  if (!offer) return null

  const amount = formatBalance(offer.amountMicros / 1_000_000)
  const detail = error || (!offer.available
    ? ui("Free credits are all claimed for now. Check back after {{time}}.", { time: signupPromoResetTime(offer.resetsAt) })
    : '')
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-500/30 bg-[color-mix(in_oklab,var(--color-emerald-500)_10%,var(--card))] px-3 py-2 text-sm text-foreground', className)}>
      <Gift className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>{ui("New here? Claim {{amount}} in free credits.", { amount })}</p>
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      </div>
      <Button size="sm" className="h-7" disabled={claiming || !offer.available} onClick={() => void claim()}>
        {claiming ? ui("Claiming…") : ui("Claim {{amount}}", { amount })}
      </Button>
    </div>
  )
}

/**
 * The out-of-balance action in chat: a claim button while the promo can be claimed,
 * otherwise `fallback` (the link to Billing).
 */
export function SignupPromoChatAction({ fallback }: { fallback: ReactNode }) {
  const { data: offer } = useSignupPromoOffer()
  const { claim, claiming, claimedMicros, error } = useSignupPromoClaim()

  if (claimedMicros !== null) {
    return <p role="status" className="text-foreground">{ui("{{amount}} in credits was added to your balance. Regenerate this response to continue.", { amount: formatBalance(claimedMicros / 1_000_000) })}</p>
  }
  if (!offer?.available) return <>{fallback}</>
  const amount = formatBalance(offer.amountMicros / 1_000_000)
  return (
    <>
      <Button size="sm" variant="outline" disabled={claiming} onClick={() => void claim()}>
        {claiming ? ui("Claiming…") : ui("Claim {{amount}}", { amount })}
      </Button>
      {error && <p>{error}</p>}
    </>
  )
}
