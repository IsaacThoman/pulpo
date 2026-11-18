/** A scope represents one uninterrupted, forward-moving execution history. */
export function canContinueWorkspaceScope(input: {
  branchReason: string
  parentResponseId: string | null
  activeResponseId: string | null
  predecessorStatus?: string
}): boolean {
  // A thread update carries on from the reply before it, like a message the user sent.
  return (input.branchReason === 'message' || input.branchReason === 'thread_update')
    && input.parentResponseId === input.activeResponseId
    && (!input.parentResponseId || ['completed', 'failed', 'cancelled', 'incomplete'].includes(input.predecessorStatus ?? ''))
}
