import type { WorkspaceDescriptor } from '@pulpo/contracts'
import type { WorkspaceFile, WorkspaceImage, WorkspaceOperation } from './controller.js'

export type WorkspaceLeaseState = 'waiting' | 'provisioning' | 'ready' | 'expired' | 'unavailable' | 'continuing_without_agent'
export type WorkspaceLeaseListener = (state: WorkspaceLeaseState, details?: Record<string, unknown>) => Promise<void>

export const SANDBOX_WORKSPACE: WorkspaceDescriptor = { kind: 'sandbox' }

/**
 * Everything the agent runner needs from a place where tools execute. The cloud sandbox
 * (`WorkspaceManager`) and a user's own computer (`ComputerWorkspace`) both implement it.
 */
export interface AgentWorkspace {
  readonly descriptor: WorkspaceDescriptor
  /** Provision or reattach to the workspace so tools can run. Resolves once ready. */
  ensureReady(signal?: AbortSignal): Promise<void>
  execute(
    operationId: string,
    type: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (output: string) => void,
    onStarted?: () => void | Promise<void>,
  ): Promise<WorkspaceOperation>
  viewImage(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceImage>
  exportFile(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceFile>
  /** Copy a generated attachment into the workspace without provisioning one when none exists yet. */
  stageGeneratedAttachment(attachmentId: string, signal?: AbortSignal): Promise<void>
  cancel(operationId: string): Promise<void>
  readonly leaseId: string | undefined
  readonly continuedWithoutAgent: boolean
  disableTools(): void
}

export function isComputerWorkspace(descriptor: WorkspaceDescriptor): descriptor is Extract<WorkspaceDescriptor, { kind: 'computer' }> {
  return descriptor.kind === 'computer'
}
