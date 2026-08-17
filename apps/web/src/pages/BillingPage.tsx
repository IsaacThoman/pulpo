import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  Download,
  Plus,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import { useAuth } from '@/stores/auth'
import { formatBalance, formatDate } from '@/lib/format'
import { chargeCentsForCredits, creditCentsFromInput } from '@/lib/billing-pricing'
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

const CREDIT_AMOUNTS = [10, 25, 50, 100] as const

interface BillingTransaction {
  id: string
  description: string
  date: number
  amount: number
}

const INITIAL_TRANSACTIONS: BillingTransaction[] = [
  { id: 'inv_2026_08_02', description: 'Credit top-up', date: Date.UTC(2026, 7, 2, 12), amount: 26.85 },
  { id: 'inv_2026_07_14', description: 'Credit top-up', date: Date.UTC(2026, 6, 14, 12), amount: 11.06 },
  { id: 'inv_2026_06_29', description: 'Credit top-up', date: Date.UTC(2026, 5, 29, 12), amount: 26.85 },
]

type TopUpStep = 'amount' | 'review' | 'success'
type PlanStep = 'details' | 'success'

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

export function BillingPage() {
  const authBalance = useAuth((state) => state.user?.balanceMicros ?? 0) / 1_000_000
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [balance, setBalance] = useState(authBalance)
  const [transactions, setTransactions] = useState(INITIAL_TRANSACTIONS)
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [topUpStep, setTopUpStep] = useState<TopUpStep>('amount')
  const [creditAmountInput, setCreditAmountInput] = useState('25.00')
  const [plan, setPlan] = useState<'baby' | 'eight' | 'fat'>('baby')
  const [planOpen, setPlanOpen] = useState(false)
  const [planStep, setPlanStep] = useState<PlanStep>('details')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [cardLastFour, setCardLastFour] = useState('4242')
  const [cardInput, setCardInput] = useState('4242 4242 4242 4242')
  const [cardName, setCardName] = useState('Pulpo User')

  useEffect(() => {
    if (searchParams.get('topup') !== '1') return
    setTopUpStep('amount')
    setTopUpOpen(true)
  }, [searchParams])

  const creditCents = creditCentsFromInput(creditAmountInput)
  const validPurchase = creditCents !== null && creditCents >= 500 && creditCents <= 50_000
  const purchaseAmount = validPurchase ? creditCents / 100 : 0
  const chargeCents = validPurchase ? chargeCentsForCredits(creditCents) : 0
  const chargeAmount = chargeCents / 100
  const feeCoverageAmount = (chargeCents - (creditCents ?? 0)) / 100

  const closeTopUp = (open: boolean) => {
    setTopUpOpen(open)
    if (!open && searchParams.get('topup') === '1') navigate('/billing', { replace: true })
  }

  const completeTopUp = () => {
    setBalance((current) => current + purchaseAmount)
    setTransactions((current) => [{
      id: `inv_preview_${Date.now()}`,
      description: 'Credit top-up',
      date: Date.now(),
      amount: chargeAmount,
    }, ...current])
    setTopUpStep('success')
  }

  const resetTopUp = () => {
    setTopUpStep('amount')
    setCreditAmountInput('25.00')
  }

  const savePaymentMethod = () => {
    const digits = cardInput.replace(/\D/g, '')
    setCardLastFour(digits.slice(-4) || '4242')
    setPaymentOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
        <h1 className="text-sm font-semibold">Billing</h1>
        <Badge variant="secondary">Prototype</Badge>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Billing</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add usage credits, manage your plan, and view payment history.
              </p>
            </div>
            <Button onClick={() => { resetTopUp(); setTopUpOpen(true) }}>
              <Plus />
              Add credits
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-5 lg:gap-0 lg:divide-x">
            <div className="py-1 lg:col-span-3 lg:pr-6">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <WalletCards className="size-4" />
                Available credit
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                {formatBalance(balance)}
              </div>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Credits are used for chats, API calls, and agent workspaces. Credits may expire after 12 months.
              </p>
            </div>

            <div className="py-1 lg:col-span-2 lg:pl-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {plan === 'fat' ? 'Le Pulpo Fat' : plan === 'eight' ? 'Pulpo Eight' : 'Pulpo Baby'}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {plan === 'fat'
                      ? '$24 monthly · renews Sep 16'
                      : plan === 'eight'
                        ? '$8 monthly · renews Sep 16'
                        : 'Free · Pay as you go'}
                  </div>
                </div>
                <Badge
                  variant={plan !== 'baby' ? 'secondary' : 'outline'}
                  className={plan === 'fat'
                    ? 'border-pink-500/25 bg-pink-500/15 text-pink-700 dark:text-pink-300'
                    : plan === 'eight'
                      ? 'border-yellow-500/25 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300'
                      : undefined}
                >
                  {plan === 'baby' ? 'Current plan' : 'Active'}
                </Badge>
              </div>
              <Button
                className="mt-4"
                variant={plan !== 'baby' ? 'outline' : 'default'}
                size="sm"
                onClick={() => { setPlanStep('details'); setPlanOpen(true) }}
              >
                {plan !== 'baby' ? 'Manage plan' : 'Compare plans'}
              </Button>
            </div>
          </div>

          <section className="space-y-3">
            <SectionHeading title="Payment history" description="Credit purchases and subscription invoices." />
            <div className="overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_100px_90px] border-b px-4 py-2.5 text-xs text-muted-foreground sm:grid">
                <div>Description</div>
                <div>Date</div>
                <div className="text-right">Amount</div>
                <div />
              </div>
              <div className="divide-y">
                {transactions.map((transaction) => (
                  <div key={transaction.id} className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_140px_100px_90px] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <ReceiptText className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{transaction.description}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">{formatDate(transaction.date)}</div>
                      </div>
                    </div>
                    <div className="hidden text-muted-foreground sm:block">{formatDate(transaction.date)}</div>
                    <div className="font-medium tabular-nums sm:text-right">{formatBalance(transaction.amount)}</div>
                    <Button variant="ghost" size="sm" className="justify-start sm:justify-center" aria-label={`Download receipt for ${formatDate(transaction.date)}`}>
                      <Download />
                      <span className="sm:sr-only">Receipt</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <Dialog open={topUpOpen} onOpenChange={closeTopUp}>
        <DialogContent className="sm:max-w-md">
          {topUpStep === 'amount' && (
            <>
              <DialogHeader>
                <DialogTitle>Add credits</DialogTitle>
                <DialogDescription>Enter how much credit you want added to your Pulpo balance.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-2">
                  {CREDIT_AMOUNTS.map((amount) => {
                    const selected = creditCents === amount * 100
                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setCreditAmountInput(amount.toFixed(2))}
                        className={cn(
                          'relative flex h-14 cursor-pointer items-center justify-center rounded-lg border text-base font-medium transition-colors hover:bg-accent',
                          selected && 'border-primary bg-accent ring-1 ring-primary',
                        )}
                      >
                        ${amount}
                        {selected && <Check className="absolute right-2 top-2 size-3.5" />}
                      </button>
                    )
                  })}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="credit-amount">Credit amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      id="credit-amount"
                      inputMode="decimal"
                      placeholder="5.00–500.00"
                      className="pl-7 text-lg tabular-nums"
                      value={creditAmountInput}
                      onChange={(event) => {
                        const value = event.target.value
                        if (value === '' || /^\d*(?:\.\d{0,2})?$/.test(value)) setCreditAmountInput(value)
                      }}
                      aria-invalid={Boolean(creditAmountInput) && !validPurchase}
                      autoFocus
                    />
                  </div>
                  {creditAmountInput && !validPurchase && (
                    <p className="text-xs text-destructive">Enter an amount between $5.00 and $500.00.</p>
                  )}
                </div>

                {validPurchase && (
                  <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Credits added</span>
                      <span className="tabular-nums">{formatBalance(purchaseAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Transaction fee coverage</span>
                      <span className="tabular-nums">{formatBalance(feeCoverageAmount)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex items-center justify-between gap-4 font-medium">
                      <span>Total before tax</span>
                      <span className="tabular-nums">{formatBalance(chargeAmount)}</span>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Estimate includes a 5% + $0.50 transaction fee. Applicable sales tax or VAT is calculated and added at checkout.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => closeTopUp(false)}>Cancel</Button>
                <Button disabled={!validPurchase} onClick={() => setTopUpStep('review')}>Continue</Button>
              </DialogFooter>
            </>
          )}

          {topUpStep === 'review' && (
            <>
              <DialogHeader>
                <DialogTitle>Review purchase</DialogTitle>
                <DialogDescription>Your credits will be available immediately.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Credits added</span>
                    <span className="font-medium">{formatBalance(purchaseAmount)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Transaction fee coverage</span>
                    <span>{formatBalance(feeCoverageAmount)}</span>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>Total before tax</span>
                    <span>{formatBalance(chargeAmount)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                  <CreditCard className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-sm">Visa ending in {cardLastFour}</div>
                  <Button variant="ghost" size="sm" onClick={() => setPaymentOpen(true)}>Change</Button>
                </div>
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                  Applicable sales tax or VAT is calculated and added at checkout.
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTopUpStep('amount')}><ArrowLeft />Back</Button>
                <Button onClick={completeTopUp}>Pay {formatBalance(chargeAmount)}</Button>
              </DialogFooter>
            </>
          )}

          {topUpStep === 'success' && (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600 dark:text-emerald-400" />
              <DialogTitle className="mt-4">Credits added</DialogTitle>
              <DialogDescription className="mx-auto mt-2 max-w-xs">
                {formatBalance(purchaseAmount)} was added to your account after a {formatBalance(chargeAmount)} payment before tax. Your new balance is {formatBalance(balance)}.
              </DialogDescription>
              <Button className="mt-6" onClick={() => closeTopUp(false)}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="sm:max-w-5xl">
          {planStep === 'details' && (
            <>
              <DialogHeader>
                <DialogTitle>Compare plans</DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-2 sm:grid-cols-3 sm:gap-0 sm:divide-x">
                <div className="flex flex-col sm:pr-5">
                  <div className="flex items-center gap-2">
                    <img src="/pulpo-smiley.png" alt="" className="size-7" />
                    <Badge variant="outline">Pulpo Baby</Badge>
                  </div>
                  <div className="mt-4 text-2xl font-semibold">Free</div>
                  <div className="mt-5 flex-1 space-y-3 text-sm">
                    {[
                      'Pay as you go',
                      'Standard workspace and file limits',
                      'Free and source-available',
                    ].map((benefit) => (
                      <div key={benefit} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {benefit}
                      </div>
                    ))}
                  </div>
                  <Button
                    className="mt-6 w-full"
                    variant="outline"
                    disabled={plan === 'baby'}
                    onClick={() => { setPlan('baby'); setPlanOpen(false) }}
                  >
                    {plan === 'baby' ? 'Current plan' : 'Switch to Pulpo Baby'}
                  </Button>
                </div>

                <div className="flex flex-col sm:px-5">
                  <div className="flex items-center gap-2">
                    <img src="/pulpo-smiley.png" alt="" className="size-7" />
                    <Badge
                      variant="secondary"
                      className="border-yellow-500/25 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
                    >
                      Pulpo Eight
                    </Badge>
                  </div>
                  <div className="mt-4 text-2xl font-semibold">
                    $8 <span className="text-sm font-normal text-muted-foreground">/ month</span>
                  </div>
                  <div className="mt-5 flex-1 space-y-3 text-sm">
                    {[
                      'Everything in Pulpo Baby',
                      'High usage limits',
                      'Higher workspace and file limits',
                      '$2 accumulating platform credits added each month',
                      'Cancel any time',
                    ].map((benefit) => (
                      <div key={benefit} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {benefit}
                      </div>
                    ))}
                  </div>
                  <Button
                    className="mt-6 w-full"
                    disabled={plan === 'eight'}
                    onClick={() => { setPlan('eight'); setPlanStep('success') }}
                  >
                    {plan === 'eight' ? 'Current plan' : 'Subscribe for $8/month'}
                  </Button>
                </div>

                <div className="flex flex-col sm:pl-5">
                  <div className="flex items-center gap-2">
                    <img src="/pulpo-smiley.png" alt="" className="size-7" />
                    <Badge
                      variant="secondary"
                      className="border-pink-500/25 bg-pink-500/15 text-pink-700 dark:text-pink-300"
                    >
                      Le Pulpo Fat
                    </Badge>
                  </div>
                  <div className="mt-4 text-2xl font-semibold">
                    $24 <span className="text-sm font-normal text-muted-foreground">/ month</span>
                  </div>
                  <div className="mt-5 flex-1 space-y-3 text-sm">
                    {[
                      'Everything in Pulpo Eight',
                      'Highest usage limits',
                      'Highest workspace and file limits',
                      '$16 accumulating platform credits added each month',
                    ].map((benefit) => (
                      <div key={benefit} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {benefit}
                      </div>
                    ))}
                  </div>
                  <Button
                    className="mt-6 w-full"
                    disabled={plan === 'fat'}
                    onClick={() => { setPlan('fat'); setPlanStep('success') }}
                  >
                    {plan === 'fat' ? 'Current plan' : 'Subscribe for $24/month'}
                  </Button>
                </div>
              </div>
            </>
          )}
          {planStep === 'success' && (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600 dark:text-emerald-400" />
              <DialogTitle className="mt-4">
                Welcome to {plan === 'fat' ? 'Le Pulpo Fat' : 'Pulpo Eight'}
              </DialogTitle>
              <DialogDescription className="mx-auto mt-2 max-w-xs">
                {plan === 'eight'
                  ? 'Your plan is active. $2 in accumulating platform credits will be added each month.'
                  : 'Your plan is active.'}
              </DialogDescription>
              <Button className="mt-6" onClick={() => setPlanOpen(false)}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Payment method</DialogTitle>
            <DialogDescription>Update the card used for purchases and subscriptions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="card-name">Name on card</Label>
              <Input id="card-name" value={cardName} onChange={(event) => setCardName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-number">Card number</Label>
              <Input id="card-number" inputMode="numeric" value={cardInput} onChange={(event) => setCardInput(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="card-expiry">Expiry</Label>
                <Input id="card-expiry" placeholder="MM / YY" defaultValue="12 / 29" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="card-cvc">CVC</Label>
                <Input id="card-cvc" inputMode="numeric" placeholder="123" defaultValue="123" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button disabled={!cardName.trim() || cardInput.replace(/\D/g, '').length < 4} onClick={savePaymentMethod}>Save card</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
