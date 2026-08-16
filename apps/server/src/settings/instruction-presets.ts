import type { PersonalizationSettings } from '@pulpo/contracts'

export interface InstructionPreferenceValues {
  customInstructions?: unknown
  instructionPresetSelections?: unknown
}

function booleanSelections(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  )
}

export function composeCustomInstructions(
  personalization: PersonalizationSettings,
  preferenceValues: InstructionPreferenceValues,
): string {
  const selections = booleanSelections(preferenceValues.instructionPresetSelections)
  const presetInstructions = personalization.instructionPresets
    .filter((preset) => selections[preset.id] ?? preset.defaultEnabled)
    .map((preset) => preset.instructions.trim())
    .filter(Boolean)
  const customInstructions = typeof preferenceValues.customInstructions === 'string'
    ? preferenceValues.customInstructions.trim()
    : ''
  return [...presetInstructions, ...(customInstructions ? [customInstructions] : [])].join('\n\n')
}
