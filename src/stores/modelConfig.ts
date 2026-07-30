import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Model, ReasoningEffort, SpeedOption } from '@/lib/types'

export interface ChatOptions {
  reasoningEfforts: ReasoningEffort[]
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

/** Effective chat options for a model: admin override wins, else the model's defaults. */
export function chatOptionsFor(model: Model, overrides: Record<string, ChatOptions>): ChatOptions {
  return (
    overrides[model.id] ?? {
      reasoningEfforts: model.reasoningEfforts,
      speedOptions: model.speedOptions,
    }
  )
}

function defaultEffort(efforts: ReasoningEffort[]): ReasoningEffort | undefined {
  if (efforts.length === 0) return undefined
  if (efforts.includes('medium')) return 'medium'
  return efforts.find((e) => e !== 'none') ?? efforts[0]
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
      prefs?.reasoningEffort && options.reasoningEfforts.includes(prefs.reasoningEffort)
        ? prefs.reasoningEffort
        : defaultEffort(options.reasoningEfforts),
    speed:
      prefs?.speed && options.speedOptions.includes(prefs.speed)
        ? prefs.speed
        : defaultSpeed(options.speedOptions),
  }
}
