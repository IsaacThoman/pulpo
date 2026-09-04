import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CreditCard,
  Loader2,
  Plus,
  ReceiptText,
  ShieldCheck,
  WalletCards,
  UsersRound,
} from 'lucide-react'
import { useAuth } from '@/stores/auth'
import { formatBalance, formatDate } from '@/lib/format'
import { creditCentsFromInput } from '@/lib/billing-pricing'
import { apiRequest } from '@/lib/api'
import { openExternalUrl } from '@/lib/runtime'
import { billingPlanName, fetchBillingSummary, managedBillingPlan, planChoiceDisabled, planChoiceLabel, type BillingPlan } from '@/lib/billing'
import { queryClient } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { SubscriptionUsageBars } from '@/components/SubscriptionUsageBars'
import { ui, uit } from '@/i18n/ui'

const CREDIT_AMOUNTS = [10, 25, 50, 100] as const

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
}

function newCheckoutKey(): string {
  return crypto.randomUUID()
}

export function BillingPage() {
  const userId = useAuth((state) => state.user?.id)
  const authBalanceMicros = useAuth((state) => state.user?.balanceMicros)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const checkoutId = searchParams.get('checkout_id')
  const checkoutReturned = searchParams.get('checkout') === 'success'
  const summaryQuery = useQuery({
    queryKey: ['billing', userId],
    queryFn: fetchBillingSummary,
    enabled: Boolean(userId),
    staleTime: 5_000,
    refetchOnWindowFocus: 'always',
  })
  const checkoutQuery = useQuery({
    queryKey: ['billing-checkout', checkoutId],
    queryFn: () => apiRequest<{ status: string }>(`/api/billing/checkouts/${encodeURIComponent(checkoutId!)}`),
    enabled: Boolean(checkoutReturned && checkoutId),
    refetchInterval: (query) => query.state.status === 'error'
      || ['succeeded', 'failed', 'expired'].includes(query.state.data?.status ?? '') ? false : 1_500,
  })

  const [topUpOpen, setTopUpOpen] = useState(false)
  const [topUpStep, setTopUpStep] = useState<'amount' | 'review'>('amount')
  const [creditAmountInput, setCreditAmountInput] = useState('25.00')
  const [topUpKey, setTopUpKey] = useState(newCheckoutKey)
  const [topUpError, setTopUpError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [planError, setPlanError] = useState('')

  useEffect(() => {
    if (searchParams.get('topup') !== '1') return
    setTopUpStep('amount')
    setTopUpOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (checkoutQuery.data?.status !== 'succeeded') return
    void queryClient.invalidateQueries({ queryKey: ['billing', userId] })
    void queryClient.invalidateQueries({ queryKey: ['usage', userId] })
  }, [checkoutQuery.data?.status, userId])

  const summary = summaryQuery.data
  const accountBalanceMicros = summary?.balanceMicros ?? authBalanceMicros
  const availableAccountBalanceMicros = summary?.availableBalanceMicros ?? accountBalanceMicros
  const creditCents = creditCentsFromInput(creditAmountInput)
  const validPurchase = creditCents !== null && creditCents >= 500 && creditCents <= 50_000
  const quoteQuery = useQuery({
    queryKey: ['billing-credit-quote', creditCents],
    queryFn: () => apiRequest<{ creditCents: number; chargeCents: number }>('/api/billing/credit-quote', {
      method: 'POST', body: { creditCents },
    }),
    enabled: validPurchase,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const quote = quoteQuery.data?.creditCents === creditCents ? quoteQuery.data : null
  const purchaseAmount = quote ? quote.creditCents / 100 : 0
  const chargeAmount = quote ? quote.chargeCents / 100 : 0
  const feeCoverageAmount = quote ? (quote.chargeCents - quote.creditCents) / 100 : 0

  const resetTopUp = () => {
    setTopUpStep('amount')
    setCreditAmountInput('25.00')
    setTopUpKey(newCheckoutKey())
    setTopUpError('')
  }

  const closeTopUp = (open: boolean) => {
    setTopUpOpen(open)
    if (!open && searchParams.get('topup') === '1') navigate('/billing', { replace: true })
  }

  const startCreditCheckout = async () => {
    if (!validPurchase || creditCents === null) return
    setSubmitting(true)
    setTopUpError('')
    try {
      const result = await apiRequest<{ url: string }>('/api/billing/checkouts/credits', {
        method: 'POST', body: { creditCents, idempotencyKey: topUpKey },
      })
      await openExternalUrl(result.url)
    } catch (error) {
      setTopUpError(error instanceof Error ? error.message : 'Could not start checkout.')
      setTopUpKey(newCheckoutKey())
      setSubmitting(false)
    }
  }

  const openPortal = async () => {
    setSubmitting(true)
    setPlanError('')
    try {
      const result = await apiRequest<{ url: string }>('/api/billing/portal', { method: 'POST' })
      await openExternalUrl(result.url)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : 'Could not open billing management.')
      setSubmitting(false)
    }
  }

  const startSubscription = async (plan: 'eight' | 'fat') => {
    setSubmitting(true)
    setPlanError('')
    try {
      const result = await apiRequest<{ url: string }>('/api/billing/checkouts/subscription', {
        method: 'POST', body: { plan, idempotencyKey: newCheckoutKey() },
      })
      await openExternalUrl(result.url)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : 'Could not start subscription checkout.')
      setSubmitting(false)
    }
  }

  const changePlan = async (plan: BillingPlan) => {
    if (!summary) return
    const managedPlan = managedBillingPlan(summary)
    if (plan === managedPlan && !summary.subscription?.cancelAtPeriodEnd) return
    if (!summary.subscription) {
      if (plan === 'baby') return
      return startSubscription(plan)
    }
    setSubmitting(true)
    setPlanError('')
    try {
      await apiRequest('/api/billing/subscription', { method: 'PATCH', body: { plan } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['billing', userId] }),
        queryClient.invalidateQueries({ queryKey: ['usage', userId] }),
      ])
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : 'Could not update your plan.')
    } finally {
      setSubmitting(false)
    }
  }

  const managedPlan = summary ? managedBillingPlan(summary) : 'baby'
  const subscriptionSubtitle = !summary
    ? 'Free · Pay as you go'
    : summary.subscription?.status === 'past_due'
      ? `Payment past due${summary.subscription.currentPeriodEnd ? ` · ${summary.planOverridden ? 'billing period' : 'access'} through ${formatDate(Date.parse(summary.subscription.currentPeriodEnd))}` : ''}`
      : !summary.subscription
        ? 'Free · Pay as you go'
      : summary.subscription?.cancelAtPeriodEnd
        ? `$${managedPlan === 'fat' ? 24 : 8}/month${summary.subscription.currentPeriodEnd ? ` · ends ${formatDate(Date.parse(summary.subscription.currentPeriodEnd))}` : ''}`
        : `$${managedPlan === 'fat' ? 24 : 8}/month${summary.subscription?.currentPeriodEnd ? ` · renews ${formatDate(Date.parse(summary.subscription.currentPeriodEnd))}` : ''}`
  const planSubtitle = summary?.planOverridden
    ? `${ui("Billed plan")}: ${billingPlanName(managedPlan)} · ${subscriptionSubtitle}`
    : subscriptionSubtitle

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div><h2 className="text-xl font-semibold tracking-tight">{ui("Billing")}</h2><p className="mt-1 text-sm text-muted-foreground">{ui("Add usage credits, manage your plan, and view payment history.")}</p></div>
            <Button onClick={() => { resetTopUp(); setTopUpOpen(true) }}><Plus />{ui("Add credits")}</Button>
          </div>

          {checkoutReturned && (
            <div className={cn(
              'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm',
              checkoutQuery.isError || checkoutQuery.data?.status === 'failed' || checkoutQuery.data?.status === 'expired'
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : 'bg-muted/30',
            )}>
              {!checkoutQuery.isError && !['succeeded', 'failed', 'expired'].includes(checkoutQuery.data?.status ?? '') && <Loader2 className="size-4 animate-spin" />}
              <span>{checkoutQuery.isError
                ? ui("Could not confirm this checkout. Your balance and payment history may already be updated.")
                : checkoutQuery.data?.status === 'succeeded'
                ? ui("Payment confirmed. Your billing balance is up to date.")
                : checkoutQuery.data?.status === 'failed' || checkoutQuery.data?.status === 'expired'
                  ? ui("Checkout was not completed.")
                  : ui("Confirming your payment… this page will update automatically.")}</span>
              <Button className="ml-auto" size="sm" variant="ghost" onClick={() => navigate('/billing', { replace: true })}>{ui("Dismiss")}</Button>
            </div>
          )}

          {summary?.onHold && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div><div className="font-medium">{ui("Billing usage is on hold")}</div><p className="mt-0.5 text-xs text-muted-foreground">{ui("Contact support so the payment reversal can be reviewed before starting more billable work.")}</p></div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-5 lg:gap-0 lg:divide-x">
            <div className="py-1 lg:col-span-3 lg:pr-6">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><WalletCards className="size-4" />{ui("Account balance")}</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                {availableAccountBalanceMicros === undefined ? '—' : formatBalance(availableAccountBalanceMicros / 1_000_000)}
              </div>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">{ui("Credits are used for chats, API calls, and other metered model usage.")}</p>
              {summary && summary.balancePendingMicros > 0 && <p className="mt-1 text-xs text-muted-foreground">{formatBalance(summary.balancePendingMicros / 1_000_000)} {ui("reserved")}</p>}
              {summary?.availablePoolBalanceMicros !== null && summary?.availablePoolBalanceMicros !== undefined && <div className="mt-6 border-t pt-5"><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><UsersRound className="size-4" />{ui("Pool balance")}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">{formatBalance(summary.availablePoolBalanceMicros / 1_000_000)}</div><p className="mt-1 text-xs text-muted-foreground">{ui("The combined account balances available to your Pool.")}</p>{summary.poolBalancePendingMicros !== null && summary.poolBalancePendingMicros > 0 && <p className="mt-1 text-xs text-muted-foreground">{formatBalance(summary.poolBalancePendingMicros / 1_000_000)} {ui("reserved")}</p>}</div>}
            </div>
            <div className="py-1 lg:col-span-2 lg:pl-6">
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-sm font-semibold">{billingPlanName(summary?.plan ?? 'baby')}</div><div className="mt-1 text-sm text-muted-foreground">{planSubtitle}</div></div>
                <PlanBadge plan={summary?.plan ?? 'baby'} overridden={summary?.planOverridden ?? false} />
              </div>
              <SubscriptionUsageBars className="mt-4" weekly={summary?.weekly ?? null} fiveHour={summary?.fiveHour ?? null} />
              <Button className="mt-4" variant={summary?.subscription ? 'outline' : 'default'} size="sm" disabled={!summary || submitting} onClick={() => setPlanOpen(true)}>
                {summary?.subscription ? ui("Manage plan") : ui("Compare plans")}
              </Button>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3"><SectionHeading title={ui("Payment history")} description={ui("Credit purchases and subscription invoices.")} />{summary?.subscription && <Button size="sm" variant="outline" onClick={() => void openPortal()} disabled={submitting}><CreditCard />{ui("Billing portal")}</Button>}</div>
            <div className="overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_100px_90px] border-b px-4 py-2.5 text-xs text-muted-foreground sm:grid"><div>{ui("Description")}</div><div>{ui("Date")}</div><div className="text-right">{ui("Amount")}</div><div className="text-right">{ui("Status")}</div></div>
              {summary?.payments.length ? <div className="divide-y">{summary.payments.map((payment) => (
                <div key={payment.id} className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_140px_100px_90px] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3"><ReceiptText className="size-4 shrink-0 text-muted-foreground" /><div className="truncate font-medium">{payment.kind === 'credits' ? uit`${formatBalance((payment.requestedCreditCents ?? 0) / 100)} credit top-up` : uit`${billingPlanName(payment.plan ?? 'baby')} subscription`}</div></div>
                  <div className="text-muted-foreground">{formatDate(Date.parse(payment.createdAt))}</div>
                  <div className="font-medium tabular-nums sm:text-right">{formatBalance(payment.amountCents / 100)}</div>
                  <div className="sm:text-right"><Badge variant={payment.status === 'refunded' ? 'destructive' : 'outline'}>{payment.status}</Badge></div>
                </div>
              ))}</div> : <div className="px-4 py-10 text-center text-sm text-muted-foreground">{ui("No payments yet.")}</div>}
            </div>
          </section>
        </div>
      </div>

      <Dialog open={topUpOpen} onOpenChange={closeTopUp}>
        <DialogContent className="sm:max-w-md">
          {topUpStep === 'amount' ? <>
            <DialogHeader><DialogTitle>{ui("Add credits")}</DialogTitle><DialogDescription>{ui("Enter how much credit you want added to your Pulpo balance.")}</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2">{CREDIT_AMOUNTS.map((amount) => {
                const selected = creditCents === amount * 100
                return <button key={amount} type="button" onClick={() => setCreditAmountInput(amount.toFixed(2))} className={cn('relative flex h-14 cursor-pointer items-center justify-center rounded-lg border text-base font-medium transition-colors hover:bg-accent', selected && 'border-primary bg-accent ring-1 ring-primary')}>${amount}{selected && <Check className="absolute right-2 top-2 size-3.5" />}</button>
              })}</div>
              <div className="space-y-2"><Label htmlFor="credit-amount">{ui("Credit amount")}</Label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input id="credit-amount" inputMode="decimal" placeholder="5.00–500.00" className="pl-7 text-lg tabular-nums" value={creditAmountInput} onChange={(event) => { const value = event.target.value; if (value === '' || /^\d*(?:\.\d{0,2})?$/.test(value)) setCreditAmountInput(value) }} aria-invalid={Boolean(creditAmountInput) && !validPurchase} autoFocus /></div>{creditAmountInput && !validPurchase && <p className="text-xs text-destructive">{ui("Enter an amount between $5.00 and $500.00.")}</p>}</div>
              {validPurchase && quoteQuery.isPending && <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{ui("Calculating total before tax…")}</div>}
              {quote && <Quote credits={purchaseAmount} fee={feeCoverageAmount} charge={chargeAmount} />}
              {quoteQuery.isError && <p className="text-xs text-destructive">{ui("Could not calculate this purchase. Try again.")}</p>}
              <p className="text-xs text-muted-foreground">{ui("Estimate includes a 5% + $0.50 platform fee. Sales tax is calculated at checkout.")}</p>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => closeTopUp(false)}>{ui("Cancel")}</Button><Button disabled={!quote} onClick={() => setTopUpStep('review')}>{ui("Continue")}</Button></DialogFooter>
          </> : <>
            <DialogHeader><DialogTitle>{ui("Review purchase")}</DialogTitle><DialogDescription>{ui("You’ll finish payment in a secure checkout.")}</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2"><Quote credits={purchaseAmount} fee={feeCoverageAmount} charge={chargeAmount} /><div className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{ui("Sales tax is calculated at checkout.")}</div>{topUpError && <p className="text-sm text-destructive">{topUpError}</p>}</div>
            <DialogFooter><Button variant="outline" disabled={submitting} onClick={() => setTopUpStep('amount')}><ArrowLeft />{ui("Back")}</Button><Button disabled={submitting} onClick={() => void startCreditCheckout()}>{submitting && <Loader2 className="animate-spin" />}{ui("Continue to checkout")}</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={planOpen} onOpenChange={(open) => { setPlanOpen(open); if (!open) setPlanError('') }}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader><DialogTitle>{ui("Compare plans")}</DialogTitle></DialogHeader>
          <div className="grid gap-6 py-2 sm:grid-cols-3 sm:gap-0 sm:divide-x">
            <PlanColumn plan="baby" current={managedPlan} cancelAtPeriodEnd={summary?.subscription?.cancelAtPeriodEnd ?? false} benefits={[ui("Pay as you go"), ui("Share platform credits with your pool"), ui("Free and source-available")]} onChoose={() => void changePlan('baby')} disabled={submitting} />
            <PlanColumn plan="eight" current={managedPlan} cancelAtPeriodEnd={summary?.subscription?.cancelAtPeriodEnd ?? false} benefits={[ui("Everything in Pulpo Baby"), ui("High usage limits"), ui("Higher workspace and file limits"), ui("$2 accumulating platform credits added each month"), ui("Cancel any time")]} onChoose={() => void changePlan('eight')} disabled={submitting} />
            <PlanColumn plan="fat" current={managedPlan} cancelAtPeriodEnd={summary?.subscription?.cancelAtPeriodEnd ?? false} benefits={[ui("Everything in Pulpo Eight"), ui("Highest usage limits"), ui("Highest workspace and file limits"), ui("$16 accumulating platform credits added each month")]} onChoose={() => void changePlan('fat')} disabled={submitting} />
          </div>
          {planError && <p className="text-center text-sm text-destructive">{planError}</p>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Quote({ credits, fee, charge }: { credits: number; fee: number; charge: number }) {
  return <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">{ui("Credits added")}</span><span className="tabular-nums">{formatBalance(credits)}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">{ui("Platform fee")}</span><span className="tabular-nums">{formatBalance(fee)}</span></div><Separator className="my-2" /><div className="flex justify-between gap-4 font-medium"><span>{ui("Total before tax")}</span><span className="tabular-nums">{formatBalance(charge)}</span></div></div>
}

function PlanBadge({ plan, overridden }: { plan: BillingPlan; overridden: boolean }) {
  return <Badge variant={plan === 'baby' ? 'outline' : 'secondary'} className={plan === 'fat' ? 'border-pink-500/25 bg-pink-500/15 text-pink-700 dark:text-pink-300' : plan === 'eight' ? 'border-yellow-500/25 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300' : undefined}>{overridden ? ui("Admin granted") : plan === 'baby' ? ui("Current plan") : ui("Active")}</Badge>
}

function PlanColumn({ plan, current, cancelAtPeriodEnd, benefits, onChoose, disabled }: { plan: BillingPlan; current: BillingPlan; cancelAtPeriodEnd: boolean; benefits: string[]; onChoose: () => void; disabled: boolean }) {
  const price = plan === 'baby' ? null : plan === 'eight' ? 8 : 24
  return <div className={cn('flex flex-col', plan === 'baby' ? 'sm:pr-5' : plan === 'eight' ? 'sm:px-5' : 'sm:pl-5')}>
    <div className="flex items-center gap-2"><img src="/pulpo-smiley.png" alt="" className="size-7" /><Badge variant={plan === 'baby' ? 'outline' : 'secondary'} className={plan === 'eight' ? 'border-yellow-500/25 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300' : plan === 'fat' ? 'border-pink-500/25 bg-pink-500/15 text-pink-700 dark:text-pink-300' : undefined}>{billingPlanName(plan)}</Badge></div>
    <div className="mt-4 text-2xl font-semibold">{price === null ? ui("Free") : <>${price} <span className="text-sm font-normal text-muted-foreground">{ui("/ month")}</span></>}</div>
    <div className="mt-5 flex-1 space-y-3 text-sm">{benefits.map((benefit) => <div key={benefit} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />{benefit}</div>)}</div>
    <Button className="mt-6 w-full" variant={plan === 'baby' ? 'outline' : 'default'} disabled={disabled || planChoiceDisabled(plan, current, cancelAtPeriodEnd)} onClick={onChoose}>{planChoiceLabel(plan, current, cancelAtPeriodEnd)}</Button>
  </div>
}
