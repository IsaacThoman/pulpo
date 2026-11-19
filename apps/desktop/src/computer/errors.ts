import type { ComputerErrorCode } from '@pulpo/contracts'

/** A refusal or failure whose message is written for the agent to read. */
export class ComputerError extends Error {
  constructor(readonly code: ComputerErrorCode, message: string) { super(message) }
}

/**
 * A request found its session gone when it was about to change something: the reply ended, or the
 * user took the access back, while the request was being prepared. Nothing more is changed then.
 */
export function assertSessionActive(active: (() => boolean) | undefined): void {
  if (active && !active()) throw new ComputerError('unknown_session', 'The reply this belongs to is over, or the user took this access back. Nothing more was changed.')
}

const MESSAGE_LIMIT = 4_000

/** Maps anything thrown while serving a request to a code and a message the agent can act on. */
export function computerErrorOf(error: unknown): { code: ComputerErrorCode; message: string } {
  if (error instanceof ComputerError) return { code: error.code, message: error.message.slice(0, MESSAGE_LIMIT) }
  const errno = (error as NodeJS.ErrnoException | undefined)?.code
  const target = (error as NodeJS.ErrnoException | undefined)?.path
  const where = typeof target === 'string' ? `: ${target}` : ''
  if (errno === 'ENOENT') return { code: 'not_found', message: `No such file or folder${where}` }
  if (errno === 'EACCES' || errno === 'EPERM') return { code: 'failed', message: `Permission denied${where}. The user's account cannot access it, or macOS has not given Pulpo access to that location.` }
  if (errno === 'ENOTDIR') return { code: 'failed', message: `Not a folder${where}` }
  if (errno === 'EISDIR') return { code: 'failed', message: `Is a folder, not a file${where}` }
  if (errno === 'EEXIST') return { code: 'failed', message: `Already exists${where}` }
  if (errno === 'ENOTEMPTY') return { code: 'failed', message: `Folder is not empty${where}` }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'failed', message: (message || 'The request failed on the user\'s computer').slice(0, MESSAGE_LIMIT) }
}
