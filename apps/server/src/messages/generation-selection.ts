import type { ExecutionMode } from '@pulpo/contracts'

interface GenerationSource {
  executionMode: ExecutionMode
  presetSelections: unknown
  agentMode: boolean
}

interface GenerationSelection {
  modelId?: string
  presetSelections?: Record<string, string>
  agentMode?: boolean
}

/** Resolve the UI generation state for a newly created response branch. */
export function resolveBranchGenerationSettings(
  original: GenerationSource,
  selection: GenerationSelection,
): {
  executionMode: ExecutionMode | undefined
  presetSelections: Record<string, string>
  agentMode: boolean
} {
  return {
    executionMode: selection.modelId || selection.presetSelections ? undefined : original.executionMode,
    presetSelections: selection.presetSelections ?? original.presetSelections as Record<string, string>,
    agentMode: selection.agentMode ?? original.agentMode,
  }
}
