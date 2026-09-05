import Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { cancelStripeResources } from './stripe-deletion.js'

function fixture() {
  const calls: string[] = []
  const stripe = {
    subscriptions: {
      list: vi.fn(async function* () { yield { id: 'sub_remote' } }),
      retrieve: vi.fn(async (id: string) => ({ id, status: id === 'sub_terminal' ? 'canceled' : 'active' })),
      cancel: vi.fn(async (id: string) => { calls.push(`cancel:${id}`) }),
    },
    checkout: { sessions: {
      list: vi.fn(async function* () { yield { id: 'cs_remote' } }),
      retrieve: vi.fn(async (id: string) => ({ id, status: id === 'cs_complete' ? 'complete' : 'open' })),
      expire: vi.fn(async (id: string) => { calls.push(`expire:${id}`) }),
    } },
  }
  return { stripe, calls, client: stripe as unknown as Stripe }
}

describe('account subscription cancellation', () => {
  it('expires checkout links before cancelling local and remotely discovered subscriptions without refunds', async () => {
    const { client, stripe, calls } = fixture()
    await cancelStripeResources(client, 'cus_user', ['sub_local', 'sub_terminal'], ['cs_local', 'cs_complete'])
    expect(calls).toEqual(['expire:cs_local', 'expire:cs_remote', 'cancel:sub_local', 'cancel:sub_remote'])
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_local', { invoice_now: false, prorate: false })
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus_user', status: 'all', limit: 100 })
  })
  it('keeps cancellation failures retryable and skips already canceled subscriptions', async () => {
    const { client, stripe } = fixture()
    stripe.subscriptions.cancel.mockRejectedValueOnce(new Error('Stripe unavailable'))
    await expect(cancelStripeResources(client, null, ['sub_local'], [])).rejects.toThrow('Stripe unavailable')
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_local', status: 'canceled' })
    await cancelStripeResources(client, null, ['sub_local'], [])
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
  })
  it('treats missing resources as already removed', async () => {
    const { client, stripe } = fixture()
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: 'Missing', code: 'resource_missing' }))
    await expect(cancelStripeResources(client, null, ['sub_missing'], [])).resolves.toBeUndefined()
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })
  it('does not proceed to cancellation when expiring a checkout fails', async () => {
    const { client, stripe } = fixture()
    stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error('Timeout'))
    await expect(cancelStripeResources(client, null, ['sub_local'], ['cs_local'])).rejects.toThrow('Timeout')
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })
})
