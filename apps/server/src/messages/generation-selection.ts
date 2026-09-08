import type { WorkspaceSelection } from '@pulpo/contracts'
import type { ExecutionMode } from '@pulpo/contracts'

interface GenerationSource {
  executionMode: ExecutionMode
  presetSelections: unknown
  workspace?: WorkspaceSelection | null
  agentMode: boolean
}

interface GenerationSelection {
  modelId?: string
  presetSelections?: Record<string, string>
  workspace?: WorkspaceSelection
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
  workspace?: WorkspaceSelection
} {
  return {
    executionMode: selection.modelId || selection.presetSelections ? undefined : original.executionMode,
    presetSelections: selection.presetSelections ?? original.presetSelections as Record<string, string>,
    workspace: selection.workspace ?? (selection.agentMode !== undefined ? { kind: selection.agentMode ? 'pulpo' : 'none' } : original.workspace ?? undefined),
    agentMode: selection.workspace ? selection.workspace.kind !== 'none' : selection.agentMode ?? original.agentMode,
  }
}
