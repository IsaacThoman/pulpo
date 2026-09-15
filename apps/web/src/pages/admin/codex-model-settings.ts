import { minimumOutputReservationTokensSchema } from '@pulpo/contracts'

export interface ManagedCodexModelSettings {
  id: string
  name: string
  upstreamModelId: string
  contextWindow: number
  maxOutputTokens: number
  minimumOutputReservationTokens: number
  compactionThresholdTokens: number
  compactionRetainedTurns: number
  maximumCompactionThresholdTokens: number
}

export function compactionContextPercent(thresholdTokens: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0
  return Math.round((thresholdTokens / contextWindow) * 100)
}

export function validManagedCodexSettings(model: ManagedCodexModelSettings): boolean {
  return minimumOutputReservationTokensSchema.safeParse(model.minimumOutputReservationTokens).success
    && Number.isInteger(model.compactionThresholdTokens)
    && model.compactionThresholdTokens >= 2_000
    && model.compactionThresholdTokens <= model.maximumCompactionThresholdTokens
    && Number.isInteger(model.compactionRetainedTurns)
    && model.compactionRetainedTurns >= 1
    && model.compactionRetainedTurns <= 32
}

export function managedCodexSettingsPatch(model: ManagedCodexModelSettings) {
  return {
    minimumOutputReservationTokens: model.minimumOutputReservationTokens,
    compactionThresholdTokens: model.compactionThresholdTokens,
    compactionRetainedTurns: model.compactionRetainedTurns,
  }
}
