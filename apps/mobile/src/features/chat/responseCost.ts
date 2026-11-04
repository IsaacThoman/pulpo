/** The usage costs the server attaches to a settled response, in USD micros. */
export interface ResponseUsageCost {
  costMicros?: number | null
  inferenceReferenceCostMicros?: number | null
}

/**
 * A response's headline cost in USD micros, as the web chat shows it: the API-equivalent reference
 * cost (if any) plus Pulpo usage. Undefined until the response has settled usage.
 */
export function responseCostMicros(cost: ResponseUsageCost): number | undefined {
  if (cost.costMicros == null || !Number.isFinite(cost.costMicros)) return undefined
  const reference = cost.inferenceReferenceCostMicros
  return cost.costMicros + (reference != null && Number.isFinite(reference) && reference > 0 ? reference : 0)
}

/** Four decimals, like the web's per-response cost ("$0.0042"). */
export function formatResponseCost(micros: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(micros / 1_000_000)
}

/** The muted line under an assistant reply: token counts, then the cost when the user opted in. */
export function responseMetaLabel(tokens: string | undefined, costMicros: number | undefined, showCost: boolean): string | undefined {
  const parts = [tokens, showCost && costMicros !== undefined ? formatResponseCost(costMicros) : undefined]
    .filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' · ') : undefined
}
