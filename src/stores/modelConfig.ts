import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Model,
  ReasoningEffort,
  ReasoningEffortOption,
  SpeedOption,
} from '@/lib/types'

export interface ChatOptions {
  reasoningEfforts: ReasoningEffortOption[]
  speedOptions: SpeedOption[]
}

interface ModelConfigState {
  /** Admin overrides per model id — which effort/speed options appear in the composer. */
  overrides: Record<string, ChatOptions>
  setOptions: (modelId: string, options: ChatOptions) => void
}

export const useModelConfig = create<ModelConfigState>()(
  persist(
    (set) => ({
      overrides: {},
      setOptions: (modelId, options) =>
        set((s) => ({ overrides: { ...s.overrides, [modelId]: options } })),
    }),
    { name: 'pulpo-model-config' }
  )
)

function displayNameForLegacyEffort(internalName: string): string {
  if (internalName === 'none') return 'Off'
  return `${internalName.charAt(0).toUpperCase()}${internalName.slice(1)}`
}

/** Convert persisted pre-pair options to the current display/internal-name shape. */
function normalizeReasoningEfforts(
  efforts: Array<ReasoningEffortOption | ReasoningEffort> | undefined
): ReasoningEffortOption[] {
  return (efforts ?? []).map((effort) =>
    typeof effort === 'string'
      ? { displayName: displayNameForLegacyEffort(effort), internalName: effort }
      : effort
  )
}

/** Effective chat options for a model: admin override wins, else the model's defaults. */
export function chatOptionsFor(model: Model, overrides: Record<string, ChatOptions>): ChatOptions {
  const options = overrides[model.id] ?? {
    reasoningEfforts: model.reasoningEfforts,
    speedOptions: model.speedOptions,
  }
  return {
    ...options,
    reasoningEfforts: normalizeReasoningEfforts(options.reasoningEfforts),
  }
}

function defaultEffort(efforts: ReasoningEffortOption[]): ReasoningEffort | undefined {
  if (efforts.length === 0) return undefined
  const medium = efforts.find((effort) => effort.internalName === 'medium')
  if (medium) return medium.internalName
  return (
    efforts.find((effort) => effort.internalName !== 'none')?.internalName ??
    efforts[0].internalName
  )
}

function defaultSpeed(speeds: SpeedOption[]): SpeedOption | undefined {
  if (speeds.length === 0) return undefined
  return speeds.includes('standard') ? 'standard' : speeds[0]
}

/** Resolve the user's saved prefs against the options an admin allows, falling back to defaults. */
export function resolveGeneration(
  options: ChatOptions,
  prefs: { reasoningEffort?: ReasoningEffort; speed?: SpeedOption } | undefined
): { reasoningEffort?: ReasoningEffort; speed?: SpeedOption } {
  return {
    reasoningEffort:
      prefs?.reasoningEffort &&
      options.reasoningEfforts.some((effort) => effort.internalName === prefs.reasoningEffort)
        ? prefs.reasoningEffort
        : defaultEffort(options.reasoningEfforts),
    speed:
      prefs?.speed && options.speedOptions.includes(prefs.speed)
        ? prefs.speed
        : defaultSpeed(options.speedOptions),
  }
}
