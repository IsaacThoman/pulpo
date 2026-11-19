import type { ComputerSelection } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'

export interface ComputerAdmissionInput {
  computer: ComputerSelection | null | undefined
  /** Whether the reply runs in Agent mode; only the agent uses the computer. */
  agentMode: boolean
  origin: 'web' | 'api' | 'admin_chat'
  /** What the sending app said it can do (`x-pulpo-client-features`). */
  clientFeatures: readonly string[] | null | undefined
  /** The `agent.computerAccess` setting. */
  computerAccess: boolean
}

/**
 * The computer a reply may use, or null. A selection on a reply that will not run in Agent mode is
 * dropped; one that is not allowed is refused rather than quietly run in the cloud, because the user
 * asked for their own computer and the reply would act somewhere else.
 */
export function admitComputer(input: ComputerAdmissionInput): ComputerSelection | null {
  if (!input.computer || !input.agentMode) return null
  if (input.origin !== 'web' || !input.clientFeatures?.includes('computer')) {
    throw new AppError(400, 'computer_unavailable', 'This computer can only be used from the Pulpo desktop app', 'invalid_request_error', 'computer')
  }
  if (!input.computerAccess) {
    throw new AppError(400, 'computer_unavailable', 'Using this computer is turned off on this Pulpo server', 'invalid_request_error', 'computer')
  }
  return input.computer
}
