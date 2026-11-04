/**
 * Plan limit errors in the app's own words. The server's messages can mention balances and dollar
 * amounts, which the native apps never show.
 */
const USAGE_LIMIT_MESSAGE = 'You’ve reached your plan’s usage limit. See Settings › Usage for when it resets.'
const DAILY_LIMIT_MESSAGE = 'You’ve reached today’s usage limit. It resets at midnight UTC.'

export function nativeUsageErrorMessage(code: string | undefined, message: string): string {
  if (code === 'daily_spend_limit_reached' || /daily usage limit/i.test(message)) return DAILY_LIMIT_MESSAGE
  if (code === 'insufficient_balance' || /insufficient balance/i.test(message)) return USAGE_LIMIT_MESSAGE
  return message
}

/** The text for a failed response's stored error, in the app's wording for plan limits. */
export function responseErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined
  const { message, code } = error as { message?: unknown; code?: unknown }
  return nativeUsageErrorMessage(typeof code === 'string' ? code : undefined, String(message ?? ''))
}
