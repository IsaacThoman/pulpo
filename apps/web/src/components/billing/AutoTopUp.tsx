import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CreditCard, Loader2, Zap } from 'lucide-react'
import {
  autoTopUpSettingsError,
  autoTopUpStatusLine,
  defaultAutoTopUpSettings,
  paymentMethodLabel,
  removeAutoTopUpPaymentMethod,
  saveAutoTopUpSettings,
  startPaymentMethodCheckout,
  type AutoTopUpSummary,
} from '@/lib/billing'
import { chargeCentsForCredits, creditCentsFromInput } from '@/lib/billing-pricing'
import { formatBalance, formatDate } from '@/lib/format'
import { openExternalUrl } from '@/lib/runtime'
import { cn } from '@/lib/utils'
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
import { Switch } from '@/components/ui/switch'
import { ui, uit } from '@/i18n/ui'

const AMOUNT_PRESETS = [10, 25, 50, 100] as const

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

function dollars(cents: number): string {
  return formatBalance(cents / 100)
}


export function MoneyInput({ id, value, onChange, invalid, placeholder }: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input
        id={id}
        inputMode="decimal"
        placeholder={placeholder}
        className="pl-7 tabular-nums"
        value={value}
        aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value
          if (next === '' || /^\d*(?:\.\d{0,2})?$/.test(next)) onChange(next)
        }}
      />
    </div>
  )
}

/** Auto top-up status under the credit balance; hidden while it is off. */
export function AutoTopUpStatus({ autoTopUp, className }: {
  autoTopUp: AutoTopUpSummary | undefined
  className?: string
}) {
  const status = autoTopUp ? autoTopUpStatusLine(autoTopUp) : null
  if (!status) return null
  const Icon = status.tone === 'muted' ? Zap : AlertTriangle
  return (
    <p className={cn('flex items-start gap-1.5 text-xs', status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground', className)}>
      <Icon className={cn('mt-0.5 size-3 shrink-0', status.tone === 'attention' && 'text-amber-600 dark:text-amber-400')} aria-hidden />
      <span>
        {status.text}
        {status.usage && <span className="block">{status.usage}</span>}
      </span>
    </p>
  )
}

export function AutoTopUpDialog({ open, onOpenChange, autoTopUp, availableBalanceMicros, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  autoTopUp: AutoTopUpSummary | undefined
  /** The balance auto top-up compares against its threshold. */
  availableBalanceMicros: number | undefined
  onSaved: () => Promise<void> | void
}) {
  const [enabled, setEnabled] = useState(true)
  const [thresholdInput, setThresholdInput] = useState('5.00')
  const [amountInput, setAmountInput] = useState('25.00')
  const [limitInput, setLimitInput] = useState('100.00')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const defaults = defaultAutoTopUpSettings(autoTopUp)
    setEnabled(defaults.enabled)
    setThresholdInput(centsToInput(defaults.thresholdCents))
    setAmountInput(centsToInput(defaults.amountCents))
    setLimitInput(centsToInput(defaults.monthlyLimitCents))
    setError('')
    setSubmitting(false)
    // oxlint-disable-next-line react/exhaustive-deps -- reset when the dialog opens, not on background refreshes
  }, [open])

  const thresholdCents = creditCentsFromInput(thresholdInput)
  const amountCents = creditCentsFromInput(amountInput)
  const monthlyLimitCents = creditCentsFromInput(limitInput)
  const validationError = autoTopUpSettingsError({ thresholdCents, amountCents, monthlyLimitCents })
  const chargeCents = amountCents !== null && validationError === null ? chargeCentsForCredits(amountCents) : null
  const paymentMethod = autoTopUp?.paymentMethod ?? null
  const needsCard = enabled && !paymentMethod
  // Saving a threshold above the current balance tops up right away, unless this
  // month's limit is already used up.
  const chargesImmediately = enabled && chargeCents !== null && thresholdCents !== null && monthlyLimitCents !== null
    && availableBalanceMicros !== undefined && availableBalanceMicros < thresholdCents * 10_000
    && (autoTopUp?.monthSpentCents ?? 0) + chargeCents <= monthlyLimitCents

  const run = async (action: () => Promise<boolean>) => {
    setSubmitting(true)
    setError('')
    try {
      if (await action()) onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ui("Could not save auto top-up."))
    } finally {
      setSubmitting(false)
    }
  }

  const addCard = async (enableAutoTopUp: boolean) => {
    const result = await startPaymentMethodCheckout(enableAutoTopUp)
    await openExternalUrl(result.url)
    return false
  }

  const save = () => run(async () => {
    if (validationError || thresholdCents === null || amountCents === null || monthlyLimitCents === null) return false
    await saveAutoTopUpSettings({ enabled, thresholdCents, amountCents, monthlyLimitCents })
    await onSaved()
    // Without a card the server keeps the settings off until checkout saves one.
    if (needsCard) return addCard(true)
    return true
  })

  const replaceCard = () => run(async () => {
    if (!validationError && thresholdCents !== null && amountCents !== null && monthlyLimitCents !== null) {
      await saveAutoTopUpSettings({ enabled, thresholdCents, amountCents, monthlyLimitCents })
    }
    return addCard(enabled)
  })

  const removeCard = () => run(async () => {
    await removeAutoTopUpPaymentMethod()
    await onSaved()
    return true
  })

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ui("Auto top-up")}</DialogTitle>
          <DialogDescription>{ui("Add credit automatically when your balance runs low.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <Label htmlFor="auto-top-up-enabled" className="text-sm font-medium">{ui("Turn on auto top-up")}</Label>
            <Switch id="auto-top-up-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className={cn('space-y-4', !enabled && 'opacity-60')}>
            <div className="space-y-2">
              <Label htmlFor="auto-top-up-threshold">{ui("When balance falls below")}</Label>
              <MoneyInput id="auto-top-up-threshold" value={thresholdInput} onChange={setThresholdInput} placeholder="5.00" invalid={thresholdCents === null} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto-top-up-amount">{ui("Add this much credit")}</Label>
              <div className="grid grid-cols-4 gap-2">{AMOUNT_PRESETS.map((amount) => {
                const selected = amountCents === amount * 100
                return (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setAmountInput(amount.toFixed(2))}
                    className={cn('relative flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium transition-colors hover:bg-accent', selected && 'border-primary bg-accent ring-1 ring-primary')}
                  >
                    ${amount}{selected && <Check className="absolute right-1 top-1 size-3" />}
                  </button>
                )
              })}</div>
              <MoneyInput id="auto-top-up-amount" value={amountInput} onChange={setAmountInput} placeholder="5.00–500.00" invalid={amountCents === null} />
              {chargeCents !== null && <p className="text-xs text-muted-foreground">{ui("Each top-up charges {{charge}} plus tax, including the 5.5% + $0.50 platform fee.", { charge: dollars(chargeCents) })}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto-top-up-limit">{ui("Monthly limit")}</Label>
              <MoneyInput id="auto-top-up-limit" value={limitInput} onChange={setLimitInput} placeholder="100.00" invalid={monthlyLimitCents === null} />
              <p className="text-xs text-muted-foreground">{ui("Automatic charges before tax never go past this amount in a calendar month (UTC). Once a top-up would pass it, auto top-up pauses until the 1st.")}</p>
            </div>
            {validationError && <p className="text-xs text-destructive">{validationError}</p>}
          </div>

          {chargesImmediately && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm" role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div>
                <div className="font-medium">{ui("Your card will be charged right away")}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{needsCard
                  ? ui("Your balance of {{balance}} is already below {{threshold}}, so {{charge}} plus tax will be charged as soon as you add your card.", { balance: formatBalance(availableBalanceMicros! / 1_000_000), threshold: dollars(thresholdCents!), charge: dollars(chargeCents!) })
                  : ui("Your balance of {{balance}} is already below {{threshold}}, so {{charge}} plus tax will be charged as soon as you save.", { balance: formatBalance(availableBalanceMicros! / 1_000_000), threshold: dollars(thresholdCents!), charge: dollars(chargeCents!) })}</p>
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
            {paymentMethod ? (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2"><CreditCard className="size-4 text-muted-foreground" aria-hidden />{paymentMethodLabel(paymentMethod)}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={submitting} onClick={() => void replaceCard()}>{ui("Change")}</Button>
                  <Button size="sm" variant="ghost" disabled={submitting} onClick={() => void removeCard()}>{ui("Remove")}</Button>
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{chargesImmediately
                ? ui("You'll add a card in a secure checkout.")
                : ui("You'll add a card in a secure checkout. It won't be charged until your balance falls below your threshold.")}</p>
            )}
            {enabled && <p className="text-xs text-muted-foreground">{ui("By turning on auto top-up, you authorize Pulpo to charge this card whenever your balance falls below your threshold, up to your monthly limit. Sales tax is added to each charge. You can turn this off at any time.")}</p>}
          </div>
          {autoTopUp?.lastAttempt && (
            <p className="text-xs text-muted-foreground">{uit`Last top-up: ${dollars(autoTopUp.lastAttempt.creditCents)} on ${formatDate(Date.parse(autoTopUp.lastAttempt.createdAt))}`}{autoTopUp.lastAttempt.status === 'failed' ? ` · ${ui("failed")}` : ''}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button disabled={submitting || validationError !== null} onClick={() => void save()}>
            {submitting && <Loader2 className="animate-spin" />}
            {needsCard
              ? ui("Save and add card")
              : chargesImmediately ? ui("Save and charge {{charge}}", { charge: dollars(chargeCents!) }) : ui("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
