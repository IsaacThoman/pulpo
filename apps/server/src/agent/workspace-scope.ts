/** A scope represents one uninterrupted, forward-moving execution history. */
export function canContinueWorkspaceScope(input: {
  branchReason: string
  parentResponseId: string | null
  activeResponseId: string | null
  predecessorStatus?: string
}): boolean {
  return input.branchReason === 'message'
    && input.parentResponseId === input.activeResponseId
    && (!input.parentResponseId || ['completed', 'failed', 'cancelled', 'incomplete'].includes(input.predecessorStatus ?? ''))
}
