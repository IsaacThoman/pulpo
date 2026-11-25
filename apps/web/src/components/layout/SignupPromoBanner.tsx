import type { SignupPromoAvailability, SignupPromoReceipt } from '@pulpo/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useFileToasts } from '@/features/files/browser/toasts'
import { ui } from '@/i18n/ui'
import { ApiError, apiRequest } from '@/lib/api'
import { formatBalance } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { BannerCard } from './BannerCard'

export function SignupPromoBanner({ userId, expiresAt }: { userId: string; expiresAt: number }) {
  const queryClient = useQueryClient()
  const queryKey = ['signup-promo', userId]
  const { data } = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAvailability>('/api/billing/signup-promo', { signal }),
    refetchInterval: () => Date.now() < expiresAt ? 60_000 : false,
    retry: false,
  })
  const offer = data?.userId === userId ? data.offer : null
  const claim = useMutation({
    mutationFn: (amountCents: number) => apiRequest<SignupPromoReceipt>('/api/billing/signup-promo/claim', {
      method: 'POST', body: { userId, amountCents },
    }),
    onSuccess: async (receipt) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<SignupPromoAvailability>(queryKey, { userId, offer: null })
      void queryClient.invalidateQueries({ queryKey: ['billing', userId] })
      void queryClient.invalidateQueries({ queryKey: ['usage', userId] })
      if (useAuth.getState().user?.id === userId) {
        useFileToasts.getState().show({ message: ui("{{amount}} added to your balance.", { amount: formatBalance(receipt.amountCents / 100) }) })
      }
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
  if (!offer) return null

  return (
    <BannerCard
      type="info"
      content={offer.message || ui("Welcome to Pulpo! Claim your signup credit.")}
      className="site-banner-enter pointer-events-auto max-w-2xl"
      action={<Button type="button" size="sm" className="-my-0.5 shrink-0" disabled={claim.isPending} onClick={() => claim.mutate(offer.amountCents)}>
        {claim.isPending ? ui("Claiming…") : ui("Claim {{amount}}", { amount: formatBalance(offer.amountCents / 100) })}
      </Button>}
    />
  )
}
