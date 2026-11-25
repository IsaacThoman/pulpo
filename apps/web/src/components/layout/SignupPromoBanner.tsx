import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Gift } from 'lucide-react'
import { ApiError, apiRequest } from '@/lib/api'
import { formatBalance, formatDateTime } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { ui, activeLocale } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { BannerCard } from './BannerCard'
import type { SignupPromoOffer } from './signup-promo'

const DISMISSED_KEY = 'pulpo.signupPromo.dismissed'
const SUCCESS_VISIBLE_MS = 6_000

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

function resetTime(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(activeLocale(), { hour: 'numeric', minute: '2-digit' })
    : formatDateTime(date.getTime())
}

/** Offers new accounts promotional credits from the banner stack, once per account. */
export function SignupPromoBanner({ offer, className }: { offer: SignupPromoOffer | null | undefined; className?: string }) {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const [dismissedUsers, setDismissedUsers] = useState(readDismissedUsers)
  const [claiming, setClaiming] = useState(false)
  const [claimedMicros, setClaimedMicros] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (claimedMicros === null) return
    const timer = setTimeout(() => setClaimedMicros(null), SUCCESS_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [claimedMicros])

  if (!userId || dismissedUsers.has(userId)) return null
  if (claimedMicros !== null) {
    return (
      <BannerCard
        type="info"
        icon={CircleCheck}
        iconClassName="text-emerald-600 dark:text-emerald-400"
        content={ui("{{amount}} in credits was added to your balance.", { amount: formatBalance(claimedMicros / 1_000_000) })}
        onDismiss={() => setClaimedMicros(null)}
        className={className}
      />
    )
  }
  if (!offer) return null

  const amount = formatBalance(offer.amountMicros / 1_000_000)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing', userId] })
  const claim = async () => {
    setClaiming(true)
    setError('')
    try {
      const result = await apiRequest<{ amountMicros: number }>('/api/billing/signup-promo/claim', { method: 'POST', body: {} })
      setClaimedMicros(result.amountMicros)
      void refresh()
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : ''
      // The offer refetch shows the budget as used up, or hides a promo that is gone.
      if (code !== 'signup_promo_budget_exhausted') setError(ui("Could not claim the credits. Try again."))
      void refresh()
    } finally {
      setClaiming(false)
    }
  }
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
        ? ui("Free credits are all claimed for now. Check back after {{time}}.", { time: resetTime(offer.resetsAt) })
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
