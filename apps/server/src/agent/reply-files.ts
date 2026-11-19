import type { ComputerDescription } from '@pulpo/contracts'
import type { FilesMirror } from '../files/agent/prompt.js'
import { computerShellToolName } from './policy.js'

/**
 * Whether a reply may use Pulpo Files through `pulpo files`, and where that command keeps its local
 * copies (the cloud's `/workspace/files` unless `mirror` says otherwise). Turns sent through admin
 * chat access never reach the owner's Files, and temporary chats have none. A full-access reply
 * has them only when the computer's app can run `pulpo files` for its commands, which it says by
 * naming `filesDir`; otherwise the reply says nothing about Files, as if they were off.
 */
export function replyFilesAccess(input: {
  filesEnabled: boolean
  adminChat: boolean
  temporary: boolean
  /** Set for a full-access reply: the computer's description, or undefined when it did not answer. */
  computer?: { description: ComputerDescription | undefined }
}): { allowed: boolean; mirror?: FilesMirror } {
  if (!input.filesEnabled || input.adminChat || input.temporary) return { allowed: false }
  if (!input.computer) return { allowed: true }
  const { description } = input.computer
  if (!description?.filesDir) return { allowed: false }
  return {
    allowed: true,
    mirror: { dir: description.filesDir, separator: description.os === 'windows' ? '\\' : '/', shell: computerShellToolName(description) },
  }
}
