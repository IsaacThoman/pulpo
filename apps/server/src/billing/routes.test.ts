import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAdminBillingRoutes } from './admin-routes.js'
import { registerBillingRoutes, resolvedCheckoutStatus } from './routes.js'

const apps: ReturnType<typeof Fastify>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('billing feature gate', () => {
  it('does not register user billing routes when billing is disabled', async () => {
    const app = Fastify()
    apps.push(app)
    await registerBillingRoutes(app)
    const response = await app.inject({ method: 'GET', url: '/api/billing/summary' })
    expect(response.statusCode).toBe(404)
  })

  it('does not register admin billing routes when billing is disabled', async () => {
    const app = Fastify()
    apps.push(app)
    await registerAdminBillingRoutes(app)
    const response = await app.inject({ method: 'GET', url: '/api/admin/billing/dashboard' })
    expect(response.statusCode).toBe(404)
  })
})

describe('checkout status resolution', () => {
  it('treats a paid order as authoritative when the checkout row is stale or missing', () => {
    expect(resolvedCheckoutStatus('open', 'paid')).toBe('succeeded')
    expect(resolvedCheckoutStatus(null, 'paid')).toBe('succeeded')
  })

  it('preserves terminal and in-progress checkout states without a paid order', () => {
    expect(resolvedCheckoutStatus('expired', null)).toBe('expired')
    expect(resolvedCheckoutStatus('processing', 'open')).toBe('processing')
    expect(resolvedCheckoutStatus(null, null)).toBeNull()
  })
})
