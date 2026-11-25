import type { ReactNode } from 'react'
import { formatBalance } from '@/lib/format'
import { ui } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { useSignupPromoClaim, useSignupPromoOffer } from '@/components/layout/signup-promo'

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
