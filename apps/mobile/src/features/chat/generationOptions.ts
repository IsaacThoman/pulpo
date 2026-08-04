import type { PrototypeModel } from '../../mockup5/src/domain'

export type GenerationSelections = Record<string, string>

/** Resolve saved values against the selected model's currently available presets. */
export function resolveGenerationSelections(
  model: PrototypeModel | undefined,
  saved: GenerationSelections | undefined,
): GenerationSelections {
  if (!model) return {}
  return Object.fromEntries(model.presets.flatMap((preset) => {
    if (!preset.choices.length) return []
    const savedId = saved?.[preset.id]
    const selected = savedId && preset.choices.some((choice) => choice.id === savedId)
      ? savedId
      : preset.selectedId && preset.choices.some((choice) => choice.id === preset.selectedId)
        ? preset.selectedId
        : preset.choices[0]!.id
    return [[preset.id, selected]]
  }))
}

export function generationSummary(
  model: PrototypeModel | undefined,
  selections: GenerationSelections,
): string {
  if (!model) return 'Options'
  const labels = model.presets.flatMap((preset) => {
    const choice = preset.choices.find((candidate) => candidate.id === selections[preset.id]) ?? preset.choices[0]
    return choice ? [choice.label] : []
  })
  return labels.join(' · ') || 'Options'
}
