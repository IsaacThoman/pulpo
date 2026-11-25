import { useState } from 'react'
import { CircleCheck, Gift } from 'lucide-react'
import { formatBalance } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { BannerCard } from './BannerCard'
import { signupPromoResetTime, useSignupPromoClaim, type SignupPromoOffer } from './signup-promo'

const DISMISSED_KEY = 'pulpo.signupPromo.dismissed'

function readDismissedUsers(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function rememberDismissal(userId: string): void {
  try {
    // A promo is only offered to young accounts, so a short list is enough.
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissedUsers(), userId].slice(-20)))
  } catch {
    // Storage can be full or disabled; dismissal then lasts for this session only.
  }
}

/** Offers new accounts promotional credits from the banner stack, once per account. */
export function SignupPromoBanner({ offer, className }: { offer: SignupPromoOffer | null | undefined; className?: string }) {
  const userId = useAuth((state) => state.user?.id)
  const [dismissedUsers, setDismissedUsers] = useState(readDismissedUsers)
  const { claim, claiming, claimedMicros, error, clearClaimed } = useSignupPromoClaim()

  if (!userId || dismissedUsers.has(userId)) return null
  if (claimedMicros !== null) {
    return (
      <BannerCard
        type="info"
        icon={CircleCheck}
        iconClassName="text-emerald-600 dark:text-emerald-400"
        content={ui("{{amount}} in credits was added to your balance.", { amount: formatBalance(claimedMicros / 1_000_000) })}
        onDismiss={clearClaimed}
        className={className}
      />
    )
  }
  if (!offer) return null

  const amount = formatBalance(offer.amountMicros / 1_000_000)
  const dismiss = () => {
    rememberDismissal(userId)
    setDismissedUsers((current) => new Set([...current, userId]))
  }

  return (
    <BannerCard
      type="info"
      icon={Gift}
      iconClassName="text-emerald-600 dark:text-emerald-400"
      content={offer.message || ui("Welcome! Claim {{amount}} in free credits to try things out.", { amount })}
      detail={error || (!offer.available
        ? ui("Free credits are all claimed for now. Check back after {{time}}.", { time: signupPromoResetTime(offer.resetsAt) })
        : undefined)}
      action={(
        <Button size="sm" className="h-7" disabled={claiming || !offer.available} onClick={() => void claim()}>
          {claiming ? ui("Claiming…") : ui("Claim {{amount}}", { amount })}
        </Button>
      )}
      onDismiss={dismiss}
      className={className}
    />
  )
}
