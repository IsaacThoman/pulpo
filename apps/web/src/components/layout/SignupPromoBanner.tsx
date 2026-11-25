import type { SignupPromoAvailability, SignupPromoReceipt } from '@pulpo/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Gift, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFileToasts } from '@/features/files/browser/toasts'
import { ui } from '@/i18n/ui'
import { ApiError, apiRequest } from '@/lib/api'
import { formatBalance } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { bannerSegments } from './banner-links'

const SUCCESS_VISIBLE_MS = 4_000
const snoozeKey = (userId: string) => `pulpo.signup-promo.snoozed.${userId}`

// "Later" hides the offer for this browser session only, so the credit is never lost to a stray click.
function readSnoozed(userId: string): boolean {
  try {
    return sessionStorage.getItem(snoozeKey(userId)) === '1'
  } catch {
    return false
  }
}

function writeSnoozed(userId: string): void {
  try {
    sessionStorage.setItem(snoozeKey(userId), '1')
  } catch {
    // Storage can be disabled; the in-memory state still hides it until reload.
  }
}

const CARD = 'site-banner-enter pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-2xl border border-emerald-500/25 bg-[color-mix(in_oklab,var(--color-emerald-500)_7%,var(--card))] py-2.5 pr-2.5 pl-2.5 text-sm shadow-sm shadow-emerald-950/5'
const ICON_TILE = 'flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'

export function SignupPromoBanner({ userId, expiresAt }: { userId: string; expiresAt: number }) {
  const queryClient = useQueryClient()
  const queryKey = ['signup-promo', userId]
  const [snoozed, setSnoozed] = useState(() => readSnoozed(userId))
  const [claimedCents, setClaimedCents] = useState<number | null>(null)
  const { data } = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAvailability>('/api/billing/signup-promo', { signal }),
    enabled: !snoozed,
    refetchInterval: () => Date.now() < expiresAt ? 60_000 : false,
    retry: false,
  })
  const offer = data?.userId === userId ? data.offer : null
  const claim = useMutation({
    mutationFn: (amountCents: number) => apiRequest<SignupPromoReceipt>('/api/billing/signup-promo/claim', {
      method: 'POST', body: { userId, amountCents },
    }),
    onSuccess: async (receipt) => {
      if (useAuth.getState().user?.id === userId) setClaimedCents(receipt.amountCents)
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
  useEffect(() => {
    if (claimedCents === null) return
    const timer = window.setTimeout(() => setClaimedCents(null), SUCCESS_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [claimedCents])

  if (claimedCents !== null) {
    return (
      <div role="status" className={CARD}>
        <span className={ICON_TILE}><CircleCheck className="size-[18px]" aria-hidden /></span>
        <p className="min-w-0 flex-1 py-0.5 pr-1 leading-snug">
          <span className="block font-semibold text-foreground">{ui("{{amount}} added to your balance.", { amount: formatBalance(claimedCents / 100) })}</span>
          <span className="block text-muted-foreground">{ui("Enjoy exploring Pulpo.")}</span>
        </p>
      </div>
    )
  }
  if (snoozed || !offer) return null

  const amount = formatBalance(offer.amountCents / 100)
  const snooze = () => {
    writeSnoozed(userId)
    setSnoozed(true)
  }
  return (
    <section aria-label={ui("Signup credit")} className={CARD}>
      <span className={ICON_TILE}><Gift className="size-[18px]" aria-hidden /></span>
      <div className="min-w-0 flex-1 py-0.5 leading-snug">
        <p className="font-semibold text-foreground">{ui("{{amount}} welcome credit", { amount })}</p>
        <p className="whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
          {bannerSegments(offer.message || ui("A little something to get you started.")).map((segment, index) => segment.kind === 'link'
            ? <a key={index} href={segment.href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground">{segment.text}</a>
            : <span key={index}>{segment.text}</span>)}
        </p>
      </div>
      <button
        type="button"
        disabled={claim.isPending}
        onClick={() => claim.mutate(offer.amountCents)}
        className={cn(
          'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-sm font-medium text-white shadow-sm transition-colors',
          'hover:bg-emerald-700 focus-visible:ring-[3px] focus-visible:ring-emerald-500/40 focus-visible:outline-none disabled:cursor-default disabled:opacity-70',
          'dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400',
        )}
      >
        {claim.isPending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
        {claim.isPending ? ui("Claiming…") : ui("Claim")}
      </button>
      <button
        type="button"
        aria-label={ui("Remind me later")}
        title={ui("Remind me later")}
        onClick={snooze}
        disabled={claim.isPending}
        className="-ml-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  )
}
