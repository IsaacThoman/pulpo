export type PolarEnvironment = 'sandbox' | 'production'

export function polarDashboardOrigin(environment: PolarEnvironment): string {
  return environment === 'sandbox' ? 'https://sandbox.polar.sh' : 'https://polar.sh'
}

export function polarDashboardUrl(environment: PolarEnvironment, path = ''): string {
  const suffix = path.startsWith('/') ? path : path ? `/${path}` : ''
  return `${polarDashboardOrigin(environment)}/to/dashboard${suffix}`
}

export function polarOrderUrl(environment: PolarEnvironment, orderId: string): string {
  return polarDashboardUrl(environment, `/sales/orders/${orderId}`)
}

export function polarSubscriptionUrl(environment: PolarEnvironment, subscriptionId: string): string {
  return polarDashboardUrl(environment, `/sales/subscriptions/${subscriptionId}`)
}

export function polarWebhooksUrl(environment: PolarEnvironment): string {
  return polarDashboardUrl(environment, '/settings/webhooks')
}
