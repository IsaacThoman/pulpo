import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

export interface SignupPromoOffer {
  amountMicros: number
  /** The admin's banner copy; empty uses the default. */
  message: string
  eligibleUntil: string
  /** False while the instance budget for this period is used up. */
  available: boolean
  resetsAt: string
}

function signupPromoQueryKey(userId: string | undefined) {
  // Under the billing key, so balance changes pushed from the server refresh it too.
  return ['billing', userId, 'signup-promo']
}

/** The promo offer for the signed-in account; never fetched where billing is off. */
export function useSignupPromoOffer(networkReady: boolean) {
  const userId = useAuth((state) => state.user?.id)
  const billingEnabled = useAuth((state) => state.billingEnabled)
  return useQuery({
    queryKey: signupPromoQueryKey(userId),
    queryFn: () => apiRequest<{ offer: SignupPromoOffer | null }>('/api/billing/signup-promo'),
    enabled: networkReady && billingEnabled && Boolean(userId),
    staleTime: 60_000,
    select: (result) => result.offer,
  })
}
