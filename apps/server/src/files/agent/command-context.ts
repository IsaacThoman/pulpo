import { posix } from 'node:path'
import type { FileAccessMode } from '@pulpo/contracts'
import type { WorkspaceManager } from '../../agent/controller.js'
import type { FileExecutor } from '../access.js'
import type { ReplyContext } from './changes.js'
import { assertScopeCurrent, FilesCommandError, type FileScope } from './scope.js'

/** What Pulpo needs from the agent's workspace: files written into it (pull) and read from it (push). */
export type FilesWorkspace = Pick<WorkspaceManager, 'writeWorkspaceFile' | 'readWorkspaceFile'>

/** One relayed `pulpo files` command, with the scope loaded for it. */
export interface CommandContext extends ReplyContext {
  scope: FileScope
  workspace: FilesWorkspace
  signal?: AbortSignal
  /** Commands set this once they changed Files, so the reply's changes item is refreshed. */
  changed: boolean
}

export interface CommandOutput {
  output: string
  data?: unknown
}

/**
 * A local path the agent named. The daemon checks too, but the sandbox is the agent's, so the
 * server never lets a path leave /workspace/ or hide `..` segments.
 */
export function workspacePath(value: string): string {
  const path = value.replace(/\/+$/, '')
  if (!path.startsWith('/workspace/') || posix.normalize(path) !== path || path.includes('\0')) {
    throw new FilesCommandError(`"${value}" is not an absolute path inside /workspace`)
  }
  return path
}

export function readOnlyMessage(path: string): string {
  return `"${path || 'My files'}" is read only. If it should change, ask the user; they can allow changes from its chip in the composer.`
}

const MODE_ORDER: FileAccessMode[] = ['read', 'suggest', 'write']

/** The more restrictive of two modes; null (outside the scope) restricts most. */
export function stricterMode(left: FileAccessMode | null, right: FileAccessMode | null): FileAccessMode | null {
  if (!left || !right) return null
  return MODE_ORDER[Math.min(MODE_ORDER.indexOf(left), MODE_ORDER.indexOf(right))]!
}

/**
 * The reply context for a change decided as `mode`: under the change's locks, the chat's scope
 * must be unchanged and `current` (the same decision, re-made in the transaction) must agree.
 */
export function guardedReply(ctx: CommandContext, mode: 'write' | 'suggest', current: (executor: FileExecutor) => Promise<FileAccessMode | null>): ReplyContext {
  return {
    userId: ctx.userId, chatId: ctx.chatId, responseId: ctx.responseId,
    guard: async (tx) => {
      await assertScopeCurrent(tx, ctx.chatId, ctx.scope)
      if (await current(tx) !== mode) throw new FilesCommandError('What you may do with this item just changed; run the command again')
    },
  }
}

/** The mode a change may use, or a FilesCommandError when the agent may not change `path`. */
export function changeMode(mode: FileAccessMode | null, path: string): 'write' | 'suggest' {
  if (!mode) throw new FilesCommandError(`"${path}" is not attached to this chat`)
  if (mode === 'read') throw new FilesCommandError(readOnlyMessage(path))
  return mode
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}
