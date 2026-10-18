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

/** Each model's choices from its newest assistant turn, so a chat reopens with the controls it last used. */
export function chatGenerationSelections(
  messages: readonly { role: string; modelId?: string; presetSelections?: GenerationSelections }[],
): Record<string, GenerationSelections> {
  const selections: Record<string, GenerationSelections> = {}
  for (const message of messages) {
    if (message.role === 'assistant' && message.modelId && message.presetSelections) selections[message.modelId] = message.presetSelections
  }
  return selections
}

/** Record one explicit choice as the account default, keeping the model's other saved choices. */
export function generationDefaultsWithChoice(
  generation: Record<string, GenerationSelections>,
  modelId: string,
  presetId: string,
  choiceId: string,
): Record<string, GenerationSelections> {
  return { ...generation, [modelId]: { ...generation[modelId], [presetId]: choiceId } }
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
