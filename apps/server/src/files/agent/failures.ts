import { AppError } from '../../lib/errors.js'
import { FilesCommandError } from './scope.js'

/**
 * What the agent is told when a command fails. Files rules (name clashes, built-in folders,
 * storage) come through as their user-facing messages; anything unexpected is logged and stays
 * generic, so internals never reach the sandbox.
 */
export function failureMessage(error: unknown): string {
  if (error instanceof FilesCommandError || error instanceof AppError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return 'The command was stopped'
  console.error(JSON.stringify({ level: 'error', event: 'files.agent_command_failed', error: error instanceof Error ? error.message : String(error) }))
  return 'Pulpo could not complete this; try again'
}
