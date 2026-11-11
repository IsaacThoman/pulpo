/** Why a draft can't be sent until Agent mode can work on it, mirroring web's nonImageAttachmentRestriction. */
export type AgentModeRestriction = 'enable_agent' | 'model_not_capable' | 'agent_unavailable'

/**
 * Attachments the model can't take inline (non-image files, too many or too large images) and
 * mentioned Files items both reach the model through the agent's workspace, so a draft with either
 * needs Agent mode on, with a model and instance that have it.
 */
export function agentModeRestriction(input: {
  /** The draft's attachments need the agent's workspace. */
  attachmentsNeedAgent: boolean
  /** The draft mentions Files items. */
  hasFileReferences: boolean
  agentEnabled: boolean
  /** The Pulpo instance offers Agent mode. */
  agentAvailable: boolean
  /** The selected model can run as an agent. */
  modelAgentCapable: boolean
}): { state: AgentModeRestriction; message: string } | null {
  if (!input.attachmentsNeedAgent && !input.hasFileReferences) return null
  const state: AgentModeRestriction | null = !input.agentAvailable
    ? 'agent_unavailable'
    : !input.modelAgentCapable
      ? 'model_not_capable'
      : !input.agentEnabled ? 'enable_agent' : null
  if (!state) return null
  return { state, message: restrictionMessage(state, input.attachmentsNeedAgent) }
}

function restrictionMessage(state: AgentModeRestriction, attachments: boolean): string {
  if (attachments) {
    return state === 'enable_agent'
      ? 'Turn on Agent mode to use these attachments (file type, image count, or image size).'
      : 'Choose an Agent-capable model or reduce these attachments.'
  }
  if (state === 'enable_agent') return 'Files items require Agent mode.'
  if (state === 'model_not_capable') return 'Switch to an Agent-capable model or remove the Files items.'
  return 'Agent mode is unavailable. Remove the Files items to send.'
}
