import type { ChatPreset } from '@pulpo/contracts'

export type PresetResolutionErrorCode = 'model_unavailable' | 'conflicting_redirects' | 'redirect_cycle'

export class PresetResolutionError extends Error {
  constructor(readonly code: PresetResolutionErrorCode, message: string) {
    super(message)
  }
}

export interface PresetResolutionModel {
  id: string
  enabled: boolean
  allowedParameters: string[]
  presets: ChatPreset[]
}

export interface ResolvedPresetActions {
  effectiveModelId: string
  parameters: Record<string, unknown>
  selections: Record<string, string>
}

const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])

export async function resolvePresetActions(
  requestedModelId: string,
  requestedSelections: Record<string, string>,
  loadModel: (modelId: string) => Promise<PresetResolutionModel | undefined>,
): Promise<ResolvedPresetActions> {
  const visited = new Set<string>()
  const parameters: Record<string, unknown> = {}
  const selections = { ...requestedSelections }
  let currentId = requestedModelId
  let initial = true

  while (!visited.has(currentId)) {
    visited.add(currentId)
    const current = await loadModel(currentId)
    if (!current?.enabled) throw new PresetResolutionError('model_unavailable', 'The selected model is unavailable')

    const redirects = new Set<string>()
    for (const preset of current.presets) {
      const requestedChoice = preset.choices.find((choice) => choice.id === selections[preset.id])
      const choice = requestedChoice ?? (initial
        ? preset.choices.find((candidate) => candidate.id === preset.defaultChoiceId) ?? preset.choices[0]
        : undefined)
      if (!choice) continue
      selections[preset.id] = choice.id
      if (choice.action.type === 'params') Object.assign(parameters, choice.action.params)
      if (choice.action.type === 'redirect') redirects.add(choice.action.modelId)
    }

    if (redirects.size === 0) {
      const allowed = new Set(current.allowedParameters)
      return {
        effectiveModelId: current.id,
        parameters: Object.fromEntries(Object.entries(parameters).filter(([key]) => allowed.has(key) && !RESERVED_PARAMETERS.has(key))),
        selections,
      }
    }
    if (redirects.size > 1) {
      throw new PresetResolutionError('conflicting_redirects', 'Preset choices redirect to different models')
    }
    currentId = [...redirects][0]!
    initial = false
  }

  throw new PresetResolutionError('redirect_cycle', 'Preset redirects contain a cycle')
}
