/** First position whose value is at least target in a sorted axis selection. */
export function lowerBound(values: readonly number[], target: number): number {
  let lo = 0, hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return lo
}
