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

export interface DraftPresets {
  presets: Record<string, GenerationSelections>
  /** History no longer reseeds a settled draft; a shared draft or an explicit choice decided it. */
  settled: boolean
}

/** A new-chat draft's first send that has not yet been accepted. */
export interface PendingStart {
  token: number
  /** The new-chat draft the send left, and the choices it was submitted with. */
  scope: string
  state: DraftPresets
  /** The draft of the chat the send opened, entered right after submission. */
  started?: { scope: string; draftId: string }
  /** Rejected and discarded while still open: the next entry may restore it. */
  rejected?: boolean
}

/**
 * Presets for a draft being opened: its chat's history, else defaults. Only
 * the entry that follows a rejected start's discard returns the new-chat draft
 * to the choices it was sent with. The discard is detected here as well, since
 * that return can render before the rejection settles.
 */
export function enterDraftPresets(
  pending: PendingStart | null,
  entering: { scope: string; draftId: string },
  messages: Parameters<typeof chatGenerationSelections>[0],
  chatExists: (draftId: string) => boolean,
): { presets: DraftPresets; pending: PendingStart | null } {
  const discarded = Boolean(pending && (pending.rejected || (pending.started && !chatExists(pending.started.draftId))))
  if (pending && discarded && entering.scope === pending.scope) return { presets: pending.state, pending: null }
  const fromHistory = chatGenerationSelections(messages)
  const presets = { presets: fromHistory, settled: Object.keys(fromHistory).length > 0 }
  if (!pending || discarded) return { presets, pending: null }
  return { presets, pending: !pending.started && entering.scope !== pending.scope ? { ...pending, started: entering } : pending }
}

/** Accepted starts own their presets; a rejection is restorable only if it discarded the chat the user is still on. */
export function settlePendingStart(
  pending: PendingStart | null,
  token: number,
  accepted: boolean,
  context: { activeScope: string | undefined; chatExists: (draftId: string) => boolean },
): PendingStart | null {
  if (!pending || pending.token !== token) return pending
  if (accepted || !pending.started || context.activeScope !== pending.started.scope || context.chatExists(pending.started.draftId)) return null
  return { ...pending, rejected: true }
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
