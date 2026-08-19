export const POLAR_STARTER_PERCENT_FEE = 0.05
export const POLAR_STARTER_FIXED_FEE_CENTS = 50

/**
 * Gross up a requested credit amount to cover Polar Starter's 5% + $0.50 fee.
 * Checkout creation must repeat this calculation on the server.
 */
export function chargeCentsForCredits(creditCents: number): number {
  if (!Number.isSafeInteger(creditCents) || creditCents < 0) {
    throw new Error('creditCents must be a non-negative integer')
  }

  return Math.ceil(
    (creditCents + POLAR_STARTER_FIXED_FEE_CENTS) / (1 - POLAR_STARTER_PERCENT_FEE),
  )
}

/** Parse a USD input with at most two decimal places without floating-point rounding. */
export function creditCentsFromInput(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null

  const [dollars, cents = ''] = normalized.split('.')
  const creditCents = Number(dollars) * 100 + Number(cents.padEnd(2, '0'))
  return Number.isSafeInteger(creditCents) ? creditCents : null
}
