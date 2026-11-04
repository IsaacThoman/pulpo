import { describe, expect, it } from 'vitest'
import { nativeUsageErrorMessage, responseErrorMessage } from './errors'

describe('plan limit errors', () => {
  it('never shows balances or dollar amounts', () => {
    expect(nativeUsageErrorMessage('insufficient_balance', 'Insufficient balance for the request')).toMatch(/plan’s usage limit/)
    const daily = nativeUsageErrorMessage('daily_spend_limit_reached', 'You’ve reached your daily usage limit of $5.00 for usage tier 1.')
    expect(daily).toMatch(/today’s usage limit/)
    expect(daily).not.toMatch(/\$|tier/)
  })

  it('rewords stored response errors, with or without a code', () => {
    expect(responseErrorMessage({ message: 'Insufficient balance for metered usage' })).toMatch(/plan’s usage limit/)
    expect(responseErrorMessage({ message: 'Upstream failed', code: 'upstream_error' })).toBe('Upstream failed')
    expect(responseErrorMessage(null)).toBeUndefined()
  })
})
