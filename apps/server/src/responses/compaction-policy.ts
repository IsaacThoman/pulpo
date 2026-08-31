export const COMPACTION_MIN_THRESHOLD_TOKENS = 2_000
export const COMPACTION_CONTEXT_SAFETY_TOKENS = 4_096

export function maximumCompactionThreshold(contextWindow: number): number {
  return Math.max(COMPACTION_MIN_THRESHOLD_TOKENS, contextWindow - COMPACTION_CONTEXT_SAFETY_TOKENS)
}

export function shouldCompactContext(options: {
  enabled: boolean
  force?: boolean
  estimatedTokens: number
  thresholdTokens: number
  unitCount: number
  retainedUnits: number
}): boolean {
  if (!options.enabled) return false
  if (!options.force && options.estimatedTokens <= options.thresholdTokens) return false
  return options.unitCount > options.retainedUnits
}
