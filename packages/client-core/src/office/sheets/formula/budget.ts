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

/** Batch hot inner-loop charges, with at most 63 units pending until flush. */
export class WorkCounter {
  private pending = 0

  consume(count = 1): void {
    this.pending += count
    if (this.pending >= 64) this.flush()
  }

  flush(): void {
    consumeWork(this.pending)
    this.pending = 0
  }
}
