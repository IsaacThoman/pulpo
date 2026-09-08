import type { WorkspaceSelection } from '@pulpo/contracts'
export type AssistantEditSource = {
  modelId: string
  pricingVersionId: string | null
  parentResponseId: string | null
  userMessageId: string | null
  executionMode: 'stream' | 'background'
  workspace?: WorkspaceSelection | null
  agentMode: boolean
  input: unknown
  instructions: string | null
  presetSelections: unknown
  parameters: unknown
}

/** Fields inherited by a manually edited assistant response branch. */
export function assistantEditInheritedValues(original: AssistantEditSource) {
  return {
    modelId: original.modelId,
    pricingVersionId: original.pricingVersionId,
    previousResponseId: original.parentResponseId,
    parentResponseId: original.parentResponseId,
    userMessageId: original.userMessageId,
    executionMode: original.executionMode,
    workspace: original.workspace,
    agentMode: original.agentMode,
    input: original.input,
    instructions: original.instructions,
    presetSelections: original.presetSelections,
    parameters: original.parameters,
  }
}
