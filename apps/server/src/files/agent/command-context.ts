import type { FileAccessMode } from '@pulpo/contracts'
import { cloudLocalPath, type AgentWorkspace } from '../../agent/workspace.js'
import type { FileExecutor } from '../access.js'
import type { ReplyContext } from './changes.js'
import { assertScopeCurrent, FilesCommandError, FilesPermissionNeeded, type FileScope } from './scope.js'

/**
 * What Pulpo needs from the agent's workspace: files written into it (pull) and read from it
 * (push), and which local paths it accepts. A workspace that does not say is a cloud one.
 */
export type FilesWorkspace = Pick<AgentWorkspace, 'writeWorkspaceFile' | 'readWorkspaceFile'> & Partial<Pick<AgentWorkspace, 'localPath'>>

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

const commandError = (error: unknown) => error instanceof FilesCommandError ? error : new FilesCommandError(error instanceof Error ? error.message : String(error))

/** A local path in a cloud workspace, confined to /workspace/ (see `cloudLocalPath`). */
export function workspacePath(value: string): string {
  try { return cloudLocalPath(value) } catch (error) { throw commandError(error) }
}

/** A local path the agent named, as the reply's workspace accepts it: /workspace/ in the cloud, anywhere on a computer. */
export function localWorkspacePath(workspace: FilesWorkspace, value: string): string {
  if (!workspace.localPath) return workspacePath(value)
  try { return workspace.localPath(value) } catch (error) { throw commandError(error) }
}

export function readOnlyMessage(path: string): string {
  return `"${path || 'My files'}" is read only. If it should change, ask the user; they can allow changes in the Pulpo Agent menu below the message box.`
}

export { stricterMode } from './scope.js'

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
  if (!mode) throw new FilesPermissionNeeded(path)
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
