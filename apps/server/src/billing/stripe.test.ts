import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { isMissingStripeResource, reusableStripeCustomerId, verifyStripeWebhookSignature } from './stripe.js'

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

describe('Stripe customer reuse', () => {
  it('reuses an existing customer', async () => {
    const client = {
      customers: { retrieve: async () => ({ id: 'cus_existing', object: 'customer' }) },
    } as unknown as Stripe

    await expect(reusableStripeCustomerId('cus_existing', client)).resolves.toBe('cus_existing')
  })

  it('recreates deleted and missing customer records', async () => {
    const deletedClient = {
      customers: { retrieve: async () => ({ id: 'cus_deleted', object: 'customer', deleted: true }) },
    } as unknown as Stripe
    const missingError = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'resource_missing',
      message: 'No such customer',
    })
    const missingClient = {
      customers: { retrieve: async () => { throw missingError } },
    } as unknown as Stripe

    await expect(reusableStripeCustomerId('cus_deleted', deletedClient)).resolves.toBeNull()
    await expect(reusableStripeCustomerId('cus_missing', missingClient)).resolves.toBeNull()
    expect(isMissingStripeResource(missingError)).toBe(true)
  })

  it('does not hide authentication or network failures', async () => {
    const error = new Stripe.errors.StripeAuthenticationError({
      type: 'invalid_request_error',
      message: 'Invalid API key',
    })
    const client = {
      customers: { retrieve: async () => { throw error } },
    } as unknown as Stripe

    await expect(reusableStripeCustomerId('cus_existing', client)).rejects.toBe(error)
  })
})
