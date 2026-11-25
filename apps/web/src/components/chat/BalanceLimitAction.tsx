import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { signupPromoClaimLabel, signupPromoSuccessLabel, useSignupPromo, useSignupPromoAccount } from '@/lib/signup-promo'

export function BalanceLimitAction() {
  const account = useSignupPromoAccount()
  return account ? <SignupCreditAction key={account.userId} {...account} /> : <BillingAction />
}

function BillingAction() {
  const { t } = useTranslation()
  return <>
    <p>{t('chat.usageLimitBillingHint')}</p>
    <Button asChild size="sm" variant="outline">
      <Link to="/billing">{t('chat.viewBilling')}</Link>
    </Button>
  </>
}

function SignupCreditAction({ userId, expiresAt }: { userId: string; expiresAt: number }) {
  const { offer, claim, pending, checking } = useSignupPromo(userId, expiresAt)
  if (claim.data) return <p role="status">{signupPromoSuccessLabel(claim.data.amountCents)}</p>
  if (!offer) return checking || pending ? null : <BillingAction />
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => claim.mutate(offer.amountCents)}>
      {signupPromoClaimLabel(offer.amountCents, pending)}
    </Button>
  )
}
