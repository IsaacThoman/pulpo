import type { WorkspaceSelection } from '@pulpo/contracts'
import { assertComputerUsable } from '../agent/computer/registry.js'
import { AppError } from '../lib/errors.js'

/** Each agent response chooses its own workspace, defaulting to the chat's last choice. */
export async function resolveWorkspaceComputer(options: {
  requested?: WorkspaceSelection
  previousComputerId: string | null
  computersEnabled: boolean
  ownerUserId: string
  requesterSessionId?: string | null
  apiKeyId?: string | null
  actorUserId?: string | null
}): Promise<string | null> {
  const computerId = options.requested
    ? options.requested.kind === 'computer' ? options.requested.computerId : null
    : options.previousComputerId
  if (!computerId) return null
  if (!options.computersEnabled) throw new AppError(403, 'computers_disabled', 'Running the agent on personal computers is turned off for this instance')
  if (options.apiKeyId || options.actorUserId || !options.requesterSessionId) {
    throw new AppError(403, 'computer_session_required', 'Computers can only be selected from a signed-in Pulpo device')
  }
  await assertComputerUsable(options.ownerUserId, options.requesterSessionId, computerId)
  return computerId
}
