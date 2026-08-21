import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { verifyStripeWebhookSignature } from './stripe.js'

const secret = 'whsec_test_signature_secret'
const stripe = new Stripe('sk_test_signature_fixture', { apiVersion: '2026-07-29.dahlia' })

describe('Stripe webhook signatures', () => {
  it('accepts a correctly signed raw request body', () => {
    const payload = JSON.stringify({
      id: 'evt_test_checkout',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1' } },
    })
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret })

    expect(verifyStripeWebhookSignature(Buffer.from(payload), signature, secret, stripe).id).toBe('evt_test_checkout')
  })

  it('rejects a modified body or invalid signature', () => {
    const payload = JSON.stringify({ id: 'evt_test_original', object: 'event', data: { object: {} } })
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret })

    expect(() => verifyStripeWebhookSignature(Buffer.from(`${payload} `), signature, secret, stripe))
      .toThrow(/signature/)
  })
})
