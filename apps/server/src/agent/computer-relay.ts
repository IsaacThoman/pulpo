import type { ComputerChangesItem } from '@pulpo/contracts'
import { isComputerRelayCommand } from '../computer/folder-relay.js'
import type { RelayRequest, RelayResult } from './workspace.js'

export type RelayHandler = (operationId: string, request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult>

/**
 * One bash command may call both `pulpo computer` and `pulpo files`; each goes to its own relay.
 * Without a folder from the computer nothing changes: Files gets every request, as before.
 */
export function routeRelayRequests(computer: RelayHandler | undefined, files: RelayHandler | undefined): RelayHandler | undefined {
  if (!computer) return files
  return (operationId, request, signal) => {
    if (isComputerRelayCommand(request.command)) return computer(operationId, request, signal)
    // The same refusal the workspace gives when nothing answers `pulpo files`.
    return files ? files(operationId, request, signal) : Promise.resolve({ ok: false, error: 'Files are not available in this chat' })
  }
}

/** The reply's one changes item for the shared folder; it is upserted, so the id is stable per reply. */
export function computerChangesItem(responseId: string, sessionId: string, totals: { applied: number; suggested: number }): ComputerChangesItem {
  return { type: 'pulpo_computer_changes', id: `${responseId}:computer-changes`, session_id: sessionId, applied: totals.applied, suggested: totals.suggested }
}
