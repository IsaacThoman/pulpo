import type { UsageLimitsPlans, UsageLimitsSubscription } from '@pulpo/contracts'
import { planName } from '../usage-limits/format'
import type { StoreKitProduct } from './storeKit'

const UNIT_NAMES = { day: 'day', week: 'week', month: 'month', year: 'year' } as const

/** "$9.99/month", in the App Store's localized price. */
export function priceLabel(product: Pick<StoreKitProduct, 'displayPrice' | 'periodUnit' | 'periodValue'>): string {
  if (!product.periodUnit) return product.displayPrice
  const unit = UNIT_NAMES[product.periodUnit]
  return product.periodValue && product.periodValue > 1
    ? `${product.displayPrice} every ${product.periodValue} ${unit}s`
    : `${product.displayPrice}/${unit}`
}

/** "1 week" or "7 days": how long a free trial lasts. */
export function freeTrialLabel(trial: NonNullable<StoreKitProduct['freeTrial']>): string {
  const unit = trial.periodUnit ? UNIT_NAMES[trial.periodUnit] : 'period'
  return `${trial.periodValue} ${unit}${trial.periodValue === 1 ? '' : 's'}`
}

/** "1 week free, then $9.99/month": the trial line under a product's price. */
export function freeTrialTermsLabel(product: Pick<StoreKitProduct, 'displayPrice' | 'periodUnit' | 'periodValue' | 'freeTrial'>): string | null {
  return product.freeTrial ? `${freeTrialLabel(product.freeTrial)} free, then ${priceLabel(product)}` : null
}

/** One line about where an App Store subscription stands. */
export function subscriptionStatusLabel(subscription: UsageLimitsSubscription, locale?: string): string {
  if (subscription.status === 'past_due') return 'The App Store couldn’t renew your subscription. Update your payment method in your Apple Account to keep your plan.'
  const date = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  if (subscription.cancelAtPeriodEnd) return date ? `Ends ${date}` : 'Ends at the end of the period'
  if (subscription.pendingPlan) return date ? `${planName(subscription.pendingPlan)} starts ${date}` : `${planName(subscription.pendingPlan)} starts at renewal`
  return date ? `Renews ${date}` : 'Renews monthly'
}

export const SUBSCRIPTION_TERMS = 'Payment is charged to your Apple Account. Subscriptions renew automatically each month unless canceled at least 24 hours before the end of the current period. Manage or cancel them in your Apple Account settings.'

/** Added to the terms while a plan is offered with a free trial. */
export const FREE_TRIAL_TERMS = 'A free trial becomes a paid subscription when it ends unless canceled at least 24 hours before then.'

/** The web's plan colors: Eight is teal and Fat is pink (Tailwind 700 in light mode, 300 in dark). */
export function planTitleColor(plan: 'eight' | 'fat', dark: boolean): string {
  if (plan === 'eight') return dark ? '#5EEAD4' : '#0F766E'
  return dark ? '#F9A8D4' : '#BE185D'
}

/** "/ month" after a large price, or "every 3 months". */
export function periodLabel(product: Pick<StoreKitProduct, 'periodUnit' | 'periodValue'>): string | null {
  if (!product.periodUnit) return null
  const unit = UNIT_NAMES[product.periodUnit]
  return product.periodValue && product.periodValue > 1 ? `every ${product.periodValue} ${unit}s` : `/ ${unit}`
}

/** Plan storage the way Settings shows it, without a trailing ".0": "10 GB", "1.5 GB", "500 MB". */
export function planStorageLabel(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${Number(gb.toFixed(1))} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

/** The web Billing page's selling points for each plan. Lines that need plan details are left out without them. */
export function planBenefits(plan: 'eight' | 'fat', plans: UsageLimitsPlans | null): string[] {
  const storage = plans ? `${planStorageLabel(plans.storageLimitBytes[plan])} of file storage` : null
  if (plan === 'eight') return ['Everything in Pulpo Baby', 'High usage limits', storage, 'Cancel any time'].filter((line): line is string => Boolean(line))
  return [
    'Everything in Pulpo Eight',
    'Highest usage limits',
    plans ? `Share ${plans.fatSharedWeeklyPercent}% of your weekly usage` : null,
    storage,
  ].filter((line): line is string => Boolean(line))
}

/** The web's fill colors for check marks and the Fat button (Tailwind 500 in light mode, 400 in dark). */
export function planFillColor(plan: 'eight' | 'fat', dark: boolean): string {
  if (plan === 'eight') return dark ? '#2DD4BF' : '#14B8A6'
  return dark ? '#F472B6' : '#EC4899'
}

/**
 * Each plan's "Choose" button in its own color. White text needs the 700 shades (the plan title colors)
 * to reach 4.5:1 in light mode; dark mode uses the 400 fills with 950 text.
 */
export function planButtonColors(plan: 'eight' | 'fat', dark: boolean): { background: string; text: string } {
  if (plan === 'eight') return dark ? { background: '#2DD4BF', text: '#042F2E' } : { background: '#0F766E', text: '#FFFFFF' }
  return dark ? { background: '#F472B6', text: '#500724' } : { background: '#BE185D', text: '#FFFFFF' }
}

/** A light wash of each plan's color, for its "Current plan" badge and Manage Subscription button (Tailwind 500 at 15%). */
export function planTintColor(plan: 'eight' | 'fat', dark: boolean): string {
  if (plan === 'eight') return dark ? 'rgba(45,212,191,0.18)' : 'rgba(20,184,166,0.14)'
  return dark ? 'rgba(244,114,182,0.18)' : 'rgba(236,72,153,0.12)'
}
