import { describe, expect, it } from 'vitest'
import { polarDashboardUrl, polarOrderUrl, polarSubscriptionUrl, polarWebhooksUrl } from './polar-dashboard'

describe('polar dashboard urls', () => {
  it('uses the sandbox host and /to/dashboard redirects', () => {
    expect(polarDashboardUrl('sandbox')).toBe('https://sandbox.polar.sh/to/dashboard')
    expect(polarWebhooksUrl('sandbox')).toBe('https://sandbox.polar.sh/to/dashboard/settings/webhooks')
    expect(polarOrderUrl('sandbox', 'ord_1')).toBe('https://sandbox.polar.sh/to/dashboard/sales/ord_1')
    expect(polarSubscriptionUrl('sandbox', 'sub_1')).toBe('https://sandbox.polar.sh/to/dashboard/sales/subscriptions/sub_1')
  })

  it('uses the production host', () => {
    expect(polarDashboardUrl('production', '/sales/ord_1')).toBe('https://polar.sh/to/dashboard/sales/ord_1')
  })
})
