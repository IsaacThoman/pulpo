import { SIGNUP_PROMO_CLAIM_MS, type SignupPromoAvailability, type SignupPromoReceipt } from '@pulpo/contracts'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFileToasts } from '@/features/files/browser/toasts'
import { ui } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { ApiError, apiRequest } from './api'
import { formatBalance } from './format'
import { isDesktopRuntime } from './runtime'

export function useSignupPromoAccount() {
  const user = useAuth((state) => state.user)
  const ready = useAuth((state) => state.instanceReady)
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const expiresAt = user ? Date.parse(user.createdAt) + SIGNUP_PROMO_CLAIM_MS : 0
  return billingEnabled && (!isDesktopRuntime() || ready) && user && user.role !== 'pending' && expiresAt > Date.now()
    ? { userId: user.id, expiresAt } : null
}

export function useSignupPromo(userId: string, expiresAt: number, poll = false) {
  const queryClient = useQueryClient()
  const queryKey = ['signup-promo', userId]
  const mutationKey = ['claim-signup-promo', userId]
  const { data, isPending: checking } = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAvailability>('/api/billing/signup-promo', { signal }),
    refetchInterval: () => poll && Date.now() < expiresAt ? 60_000 : false,
    retry: false,
  })
  const claim = useMutation({
    mutationKey,
    mutationFn: (amountCents: number) => apiRequest<SignupPromoReceipt>('/api/billing/signup-promo/claim', {
      method: 'POST', body: { userId, amountCents },
    }),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<SignupPromoAvailability>(queryKey, { userId, offer: null })
      void queryClient.invalidateQueries({ queryKey: ['billing', userId] })
      void queryClient.invalidateQueries({ queryKey: ['usage', userId] })
    },
    onError: (error) => {
      if (useAuth.getState().user?.id !== userId) return
      const changed = error instanceof ApiError && error.status === 409
      if (changed) void queryClient.invalidateQueries({ queryKey })
      useFileToasts.getState().show({
        tone: 'error',
        message: changed ? ui(error.message) : ui("Could not claim signup credit. Try again."),
      })
    },
  })
  const pending = useIsMutating({ mutationKey }) > 0
  return { offer: data?.userId === userId ? data.offer : null, claim, pending, checking }
}

export function signupPromoClaimLabel(amountCents: number, pending: boolean) {
  return pending ? ui("Claiming…") : ui("Claim {{amount}}", { amount: formatBalance(amountCents / 100) })
}

export function signupPromoSuccessLabel(amountCents: number) {
  return ui("{{amount}} added to your balance.", { amount: formatBalance(amountCents / 100) })
}
