/**
 * Plan limit errors in the app's own words. The server's messages can mention balances and dollar
 * amounts, which the native apps never show.
 */
const USAGE_LIMIT_MESSAGE = 'You’ve reached your plan’s usage limit. See Settings › Usage for when it resets.'
const DAILY_LIMIT_MESSAGE = 'You’ve reached today’s usage limit. It resets at midnight UTC.'

const USAGE_LIMIT_CODES = new Set(['insufficient_balance', 'daily_spend_limit_reached'])

/** Whether a failed send was refused for a plan's usage limit (HTTP 402), so the turn can stay in the chat. */
export function isUsageLimitRejection(error: unknown): error is Error & { status: number; code: string } {
  if (!(error instanceof Error) || !('status' in error) || !('code' in error)) return false
  return error.status === 402 && typeof error.code === 'string' && USAGE_LIMIT_CODES.has(error.code)
}

/** Whether a response's error is one of the app's plan limit messages, which link to Settings › Usage. */
export function isUsageLimitMessage(message: string | undefined): boolean {
  return message === USAGE_LIMIT_MESSAGE || message === DAILY_LIMIT_MESSAGE
}

/** A plan limit error shown beside a View Usage button, which makes "See Settings › Usage" redundant. */
export function usageLimitNoticeText(message: string): string {
  return message === USAGE_LIMIT_MESSAGE ? 'You’ve reached your plan’s usage limit.' : message
}

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
