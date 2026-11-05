/** A synchronous recalculation shares its work allowance across every formula and retry. */
export const MAX_CALC_WORK = 50_000_000

export class CalculationStopped extends Error {}

let remaining: number | undefined

/** Installs a budget until the caller restores the previous synchronous evaluation context. */
export function calculationBudget(limit = MAX_CALC_WORK): () => void {
  const previous = remaining
  remaining = Math.min(limit, MAX_CALC_WORK)
  return () => { remaining = previous }
}

export function consumeWork(count = 1): void {
  if (remaining === undefined) return
  remaining -= count
  if (remaining < 0) throw new CalculationStopped()
}
