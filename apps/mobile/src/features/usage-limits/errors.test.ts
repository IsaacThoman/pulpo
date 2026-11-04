import { describe, expect, it } from 'vitest'
import { isUsageLimitMessage, isUsageLimitRejection, nativeUsageErrorMessage, responseErrorMessage, usageLimitNoticeText } from './errors'

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

  it('recognizes a send refused for a plan limit and the messages that link to Usage', () => {
    const rejection = (status: number, code: string) => Object.assign(new Error('Insufficient balance'), { status, code })
    expect(isUsageLimitRejection(rejection(402, 'insufficient_balance'))).toBe(true)
    expect(isUsageLimitRejection(rejection(402, 'daily_spend_limit_reached'))).toBe(true)
    expect(isUsageLimitRejection(rejection(500, 'insufficient_balance'))).toBe(false)
    expect(isUsageLimitRejection(rejection(402, 'payment_required'))).toBe(false)
    expect(isUsageLimitRejection(new Error('offline'))).toBe(false)
    expect(isUsageLimitMessage(nativeUsageErrorMessage('insufficient_balance', 'x'))).toBe(true)
    expect(isUsageLimitMessage(nativeUsageErrorMessage('daily_spend_limit_reached', 'x'))).toBe(true)
    expect(isUsageLimitMessage('Upstream failed')).toBe(false)
    expect(usageLimitNoticeText(nativeUsageErrorMessage('insufficient_balance', 'x'))).toBe('You’ve reached your plan’s usage limit.')
    expect(usageLimitNoticeText(nativeUsageErrorMessage('daily_spend_limit_reached', 'x'))).toMatch(/midnight UTC/)
  })
})
