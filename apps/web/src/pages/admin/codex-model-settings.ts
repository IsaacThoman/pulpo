import { createModelSchema, minimumOutputReservationTokensSchema } from '@pulpo/contracts'

export const DEFAULT_RETAINED_USER_TOKENS = 20_000
export const MAX_RETAINED_USER_TOKENS = 100_000
const retainedUserTokensSchema = createModelSchema.shape.compactionRetainedUserTokens.removeDefault()

export interface ManagedCodexModelSettings {
  id: string
  name: string
  upstreamModelId: string
  contextWindow: number
  maxOutputTokens: number
  minimumOutputReservationTokens: number
  compactionThresholdTokens: number
  compactionRetainedUserTokens: number
  maximumCompactionThresholdTokens: number
}

export function compactionContextPercent(thresholdTokens: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0
  return Math.round((thresholdTokens / contextWindow) * 100)
}

export function validRetainedUserTokens(value: number): boolean {
  return retainedUserTokensSchema.safeParse(value).success
}

export function validManagedCodexSettings(model: ManagedCodexModelSettings): boolean {
  return minimumOutputReservationTokensSchema.safeParse(model.minimumOutputReservationTokens).success
    && Number.isInteger(model.compactionThresholdTokens)
    && model.compactionThresholdTokens >= 2_000
    && model.compactionThresholdTokens <= model.maximumCompactionThresholdTokens
    && validRetainedUserTokens(model.compactionRetainedUserTokens)
}

export function managedCodexSettingsPatch(model: ManagedCodexModelSettings) {
  return {
    minimumOutputReservationTokens: model.minimumOutputReservationTokens,
    compactionThresholdTokens: model.compactionThresholdTokens,
    compactionRetainedUserTokens: model.compactionRetainedUserTokens,
  }
}
