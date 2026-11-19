import { posix } from 'node:path'
import { attachmentWorkspacePath, restoredAttachmentWorkspacePath } from './policy.js'

export const MAX_VIEW_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_EXPORT_FILE_BYTES = 25 * 1024 * 1024

/** A `pulpo files` call from a bash command, held by the workspace daemon until Pulpo answers. Agent-controlled input. */
export interface RelayRequest { id: string; command: string; args: unknown }
/** `output` is what the CLI prints; `data` carries command-specific results such as pulled or pushed files. */
export type RelayResult = { ok: true; output: string; data?: unknown } | { ok: false; error: string }

export interface WorkspaceOperation {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  error?: string
  details?: Record<string, unknown>
  /** Present on daemons that relay `pulpo files` and support long-polls; absent on older images. */
  relay?: { version: number; pending: RelayRequest[] }
}

export interface WorkspaceImage {
  data: string
  mimeType: string
  sizeBytes: number
}

export interface WorkspaceFile {
  data: Uint8Array
  sizeBytes: number
}

export type WorkspaceLeaseState = 'waiting' | 'provisioning' | 'ready' | 'expired' | 'unavailable' | 'continuing_without_agent'
export type WorkspaceLeaseEvent = (state: WorkspaceLeaseState, details?: Record<string, unknown>) => Promise<void>

export interface RestorableAttachment {
  id: string
  originalName: string
  origin: string
  workspacePath: string | null
}

/** Paths the server chooses or checks itself; the agent's own paths go to the workspace as they are. */
export interface WorkspacePaths {
  /** Where a chat attachment is saved for the agent. */
  attachment(name: string, id: string): string
  /** Where an attachment is restored in a later reply (an assistant deliverable may keep its original path). */
  restoredAttachment(attachment: RestorableAttachment): string
  /** A file the server creates for the agent, such as a generated image. */
  file(name: string): string
  /** Whether the server may read `path` when the agent names it (image references). */
  readable(path: string): boolean
}

export const cloudWorkspacePaths: WorkspacePaths = {
  attachment: attachmentWorkspacePath,
  restoredAttachment: restoredAttachmentWorkspacePath,
  file: (name) => `/workspace/${name}`,
  readable: (path) => path.startsWith('/workspace/'),
}

/**
 * A local path the agent named for `pulpo files pull|push` in a cloud workspace. The daemon checks
 * too, but the sandbox is the agent's, so the server never lets a path leave /workspace/ or hide
 * `..` segments.
 */
export function cloudLocalPath(value: string): string {
  const path = value.replace(/\/+$/, '')
  if (!path.startsWith('/workspace/') || posix.normalize(path) !== path || path.includes('\0')) {
    throw new Error(`"${value}" is not an absolute path inside /workspace`)
  }
  return path
}

/**
 * Where an agent reply's tools run: a cloud workspace pod (`WorkspaceManager`) or the user's own
 * computer through the desktop app (`ComputerWorkspace`).
 */
export interface AgentWorkspace {
  readonly kind: 'cloud' | 'computer'
  readonly paths: WorkspacePaths
  /** Describes the environment before inference; never provisions anything. */
  contextNotice(): Promise<string>
  /** Makes the workspace usable and returns an id generated files are tied to. */
  ensureLease(signal?: AbortSignal): Promise<string>
  execute(
    operationId: string,
    type: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (output: string) => void,
    onStarted?: () => void | Promise<void>,
    onRelay?: (request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult>,
  ): Promise<WorkspaceOperation>
  viewImage(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceImage>
  exportFile(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceFile>
  writeWorkspaceFile(path: string, body: Uint8Array | NodeJS.ReadableStream, sizeBytes: number, signal?: AbortSignal): Promise<void>
  readWorkspaceFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
  saveGeneratedFile(path: string, data: Uint8Array, mimeType: string, leaseId: string, signal?: AbortSignal): Promise<void>
  readGeneratedFile(path: string, leaseId: string, signal?: AbortSignal): Promise<WorkspaceFile>
  cancel(operationId: string): Promise<void>
  /**
   * A local path the agent named for `pulpo files pull|push`, as this workspace accepts it, or an
   * error whose message is written for the agent.
   */
  localPath(value: string): string
  /** The `workspace_leases` row, for records that reference it; always undefined for a computer. */
  readonly leaseId: string | undefined
  /** Tools are off for the rest of the reply (the user continued without them, or the workspace went away). */
  readonly continuedWithoutAgent: boolean
  disableTools(): void
}
