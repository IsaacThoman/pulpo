export type StripeMode = 'test' | 'live'

export function stripeDashboardUrl(mode: StripeMode, path = ''): string {
  const prefix = mode === 'test' ? '/test' : ''
  const suffix = path ? `/${path.replace(/^\/+/, '')}` : ''
  return `https://dashboard.stripe.com${prefix}${suffix}`
}

export function stripePaymentUrl(mode: StripeMode, paymentId: string): string {
  return stripeDashboardUrl(mode, paymentId.startsWith('in_') ? `/invoices/${paymentId}` : `/payments/${paymentId}`)
}

export function stripeSubscriptionUrl(mode: StripeMode, subscriptionId: string): string {
  return stripeDashboardUrl(mode, `/subscriptions/${subscriptionId}`)
}

export function stripeWebhooksUrl(mode: StripeMode): string {
  return stripeDashboardUrl(mode, '/webhooks')
}
