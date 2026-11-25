import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'
import { signupPromoClaimLabel, signupPromoSuccessLabel, useSignupPromo } from '@/lib/signup-promo'
import { bannerSegments } from './banner-links'

const card = 'site-banner-enter pointer-events-auto relative w-fit max-w-md rounded-xl border bg-card px-4 py-2.5 text-center text-sm'
const snoozeKey = (userId: string) => `pulpo.signup-promo.snoozed.${userId}`

export function SignupPromoBanner(props: { userId: string; expiresAt: number }) {
  const [snoozed, setSnoozed] = useState(() => {
    try { return sessionStorage.getItem(snoozeKey(props.userId)) === '1' } catch { return false }
  })
  if (snoozed) return null
  return <PromoCard {...props} onDismiss={() => {
    try { sessionStorage.setItem(snoozeKey(props.userId), '1') } catch { /* Dismiss for this mount. */ }
    setSnoozed(true)
  }} />
}

function PromoCard({ userId, expiresAt, onDismiss }: { userId: string; expiresAt: number; onDismiss: () => void }) {
  const { offer, claim, pending } = useSignupPromo(userId, expiresAt, true)
  const [confirmationVisible, setConfirmationVisible] = useState(true)
  const receipt = claim.data
  useEffect(() => {
    if (!receipt) return
    const timer = window.setTimeout(() => setConfirmationVisible(false), 4_000)
    return () => window.clearTimeout(timer)
  }, [receipt])

  if (receipt) {
    return confirmationVisible ? <p role="status" className={card}>{signupPromoSuccessLabel(receipt.amountCents)}</p> : null
  }
  if (!offer) return null
  return (
    <section aria-label={ui("Signup credit")} className={card}>
      <p className="whitespace-pre-line px-5 [overflow-wrap:anywhere]">
        {bannerSegments(offer.message || ui("Welcome to Pulpo!")).map((segment, index) => segment.kind === 'link'
          ? <a key={index} href={segment.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{segment.text}</a>
          : <span key={index}>{segment.text}</span>)}
      </p>
      <Button type="button" size="sm" className="mt-2" disabled={pending} onClick={() => claim.mutate(offer.amountCents)}>
        {signupPromoClaimLabel(offer.amountCents, pending)}
      </Button>
      <Button type="button" size="icon-sm" variant="ghost" className="absolute top-1 right-1 size-7"
        aria-label={ui("Remind me later")} disabled={pending} onClick={onDismiss}>
        <X aria-hidden />
      </Button>
    </section>
  )
}
