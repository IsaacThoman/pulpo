import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatPreset, ChatPresetChoice, Model } from '@/lib/types'

export interface ChatOptions {
  presets: ChatPreset[]
}

interface ModelConfigState {
  /** Admin overrides per model id. */
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
  return overrides[model.id] ?? { presets: model.presets }
}

/** Resolve saved choice ids against available presets. */
export function resolveSelections(
  options: ChatOptions,
  prefs: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const preset of options.presets) {
    if (preset.choices.length === 0) continue
    const saved = prefs?.[preset.id]
    if (saved && preset.choices.some((c) => c.id === saved)) {
      out[preset.id] = saved
    } else if (preset.defaultChoiceId && preset.choices.some((c) => c.id === preset.defaultChoiceId)) {
      out[preset.id] = preset.defaultChoiceId
    } else {
      out[preset.id] = preset.choices[0]!.id
    }
  }
  return out
}

export function choiceFor(
  options: ChatOptions,
  selections: Record<string, string>,
  presetId: string
): ChatPresetChoice | undefined {
  const preset = options.presets.find((p) => p.id === presetId)
  if (!preset) return undefined
  const id = selections[presetId]
  return preset.choices.find((c) => c.id === id) ?? preset.choices[0]
}

/** Apply redirects and merge custom params from selected choices. */
export function resolveGeneration(
  options: ChatOptions,
  prefs: Record<string, string> | undefined,
  baseModelId: string
): {
  selections: Record<string, string>
  effectiveModelId: string
  customParams: Record<string, unknown>
  choices: ChatPresetChoice[]
} {
  const selections = resolveSelections(options, prefs)
  let effectiveModelId = baseModelId
  const customParams: Record<string, unknown> = {}
  const choices: ChatPresetChoice[] = []

  for (const preset of options.presets) {
    const choice = choiceFor(options, selections, preset.id)
    if (!choice) continue
    choices.push(choice)
    if (choice.action.type === 'redirect' && choice.action.modelId) {
      effectiveModelId = choice.action.modelId
    }
    if (choice.action.type === 'params') {
      Object.assign(customParams, choice.action.params)
    }
  }

  return { selections, effectiveModelId, customParams, choices }
}
