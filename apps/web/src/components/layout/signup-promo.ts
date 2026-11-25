import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { activeLocale, ui } from '@/i18n/ui'

export interface SignupPromoOffer {
  amountMicros: number
  /** The admin's banner copy; empty uses the default. */
  message: string
  eligibleUntil: string
  /** False while the instance budget for this period is used up. */
  available: boolean
  resetsAt: string
}

const SUCCESS_VISIBLE_MS = 6_000

function signupPromoQueryKey(userId: string | undefined) {
  // Under the billing key, so balance changes pushed from the server refresh it too.
  return ['billing', userId, 'signup-promo']
}

/** The promo offer for the signed-in account; never fetched where billing is off. */
export function useSignupPromoOffer(enabled = true) {
  const userId = useAuth((state) => state.user?.id)
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const instanceReady = useAuth((state) => state.instanceReady)
  const networkReady = !isDesktopRuntime() || instanceReady
  return useQuery({
    queryKey: signupPromoQueryKey(userId),
    queryFn: () => apiRequest<{ offer: SignupPromoOffer | null }>('/api/billing/signup-promo'),
    enabled: enabled && networkReady && billingEnabled && Boolean(userId),
    staleTime: 60_000,
    select: (result) => result.offer,
  })
}

/** Claims the promo and keeps a short-lived confirmation once the offer itself is gone. */
export function useSignupPromoClaim() {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const [claiming, setClaiming] = useState(false)
  const [claimedMicros, setClaimedMicros] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (claimedMicros === null) return
    const timer = setTimeout(() => setClaimedMicros(null), SUCCESS_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [claimedMicros])

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
  return { claim, claiming, claimedMicros, error, clearClaimed: () => setClaimedMicros(null) }
}

export function signupPromoResetTime(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(activeLocale(), { hour: 'numeric', minute: '2-digit' })
    : formatDateTime(date.getTime())
}
