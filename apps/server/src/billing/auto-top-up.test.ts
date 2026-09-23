import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { isTerminalStripeFailure } from './auto-top-up.js'

function stripeError(type: string, statusCode: number, code?: string) {
  return Stripe.errors.StripeError.generate({ type, code, message: 'fixture', statusCode } as never)
}

describe('automatic top-up charge failures', () => {
  it('ends the attempt for declines and rejected requests', () => {
    expect(isTerminalStripeFailure(stripeError('card_error', 402, 'card_declined'))).toBe(true)
    expect(isTerminalStripeFailure(stripeError('invalid_request_error', 400, 'customer_tax_location_invalid'))).toBe(true)
  })

  it('leaves outages and retryable errors for the sweep', () => {
    expect(isTerminalStripeFailure(stripeError('api_error', 500))).toBe(false)
    expect(isTerminalStripeFailure(stripeError('idempotency_error', 400))).toBe(false)
    expect(isTerminalStripeFailure(new Error('socket hang up'))).toBe(false)
  })
})
