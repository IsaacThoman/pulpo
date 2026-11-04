import type { UsageLimitsSubscription } from '@pulpo/contracts'
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
