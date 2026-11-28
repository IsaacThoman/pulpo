import type { CreditSummary } from '@pulpo/contracts'
import { planName } from '../usage-limits/format'

type Payment = CreditSummary['payments'][number]

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** US dollars from cents, as the web shows balances: `$1,234.56`, `-$0.42`. */
export function formatUsdCents(cents: number): string {
  const rounded = Math.round(cents)
  const whole = Math.trunc(Math.abs(rounded) / 100)
  const fraction = String(Math.abs(rounded) % 100).padStart(2, '0')
  return `${rounded < 0 ? '-' : ''}$${groupThousands(String(whole))}.${fraction}`
}

/** US dollars from micros (millionths of a dollar), rounded to the cent. */
export function formatUsdMicros(micros: number): string {
  return formatUsdCents(Math.round(micros / 10_000))
}

/** A payment's description, in the web's Payment history wording. */
export function paymentTitle(payment: Payment): string {
  if (payment.kind === 'credits') {
    const amount = formatUsdCents(payment.requestedCreditCents ?? 0)
    return payment.automatic ? `${amount} auto top-up` : `${amount} credit top-up`
  }
  const plan = planName(payment.plan ?? 'baby')
  return payment.provider === 'app_store' ? `${plan} subscription · App Store` : `${plan} subscription`
}

export function paymentStatusLabel(status: string): string {
  if (status === 'paid') return 'Paid'
  if (status === 'refunded') return 'Refunded'
  return 'Unknown'
}

export function paymentDetail(payment: Payment, locale?: string): string {
  const date = new Date(payment.createdAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${date} · ${paymentStatusLabel(payment.status)}`
}

/** The auto top-up a card on the web keeps running, or Off. Set up and changed on the web. */
export function autoTopUpLabel(autoTopUp: CreditSummary['autoTopUp']): string {
  if (!autoTopUp.enabled || autoTopUp.amountCents === null || autoTopUp.thresholdCents === null) return 'Off'
  return `${formatUsdCents(autoTopUp.amountCents)} below ${formatUsdCents(autoTopUp.thresholdCents)}`
}

/** When a used-up promo budget refills: a time today, otherwise a date and time. */
export function promoResetLabel(iso: string, now = new Date(), locale?: string): string {
  const date = new Date(iso)
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
