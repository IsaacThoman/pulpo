import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import {
  COMPUTER_FILE_CHUNK_BYTES, toolApprovalRequired,
  type ComputerOperationSnapshot, type ComputerRequest, type ComputerWorkspaceDescriptor, type ToolApprovalItem,
} from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { applicationSettings, attachments, workspaceLeases } from '../../database/schema.js'
import { getBlobStore } from '../../storage/index.js'
import { newId } from '../../lib/ids.js'
import { AppError } from '../../lib/errors.js'
import { parseAgentSettings } from '../../settings/application-settings.js'
import type { WorkspaceFile, WorkspaceImage, WorkspaceOperation } from '../controller.js'
import { detectImageMime } from '../images.js'
import { restoredAttachmentWorkspacePath } from '../policy.js'
import type { AgentWorkspace, WorkspaceLeaseListener } from '../workspace.js'
import { createToolApproval, toolApprovalItem, toolApprovalSummary, waitForToolApproval, type ApprovalOutcome } from './approvals.js'
import { computerIsOnline } from './presence.js'
import { computerDescriptor, loadRunnableComputer, recordComputerAudit, type ComputerRow } from './registry.js'
import { ComputerRpcError, computerRpc, type ComputerRpcClient } from './rpc.js'

const MAX_VIEW_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_EXPORT_FILE_BYTES = 25 * 1024 * 1024
const OPERATION_POLL_MS = 250
const RPC_TIMEOUT_MS = 30_000

export type ApprovalEventState = 'requested' | ApprovalOutcome

export interface ComputerWorkspaceOptions {
  responseId: string
  chatId: string
  userId: string
  agentRunId: string
  computer: ComputerRow
  onLeaseEvent?: WorkspaceLeaseListener
  onApprovalEvent?: (state: ApprovalEventState, item: ToolApprovalItem) => Promise<void>
  rpc?: ComputerRpcClient
}

/** Runs agent tools on a user's own computer through the desktop app's `/computer` socket. */
export class ComputerWorkspace implements AgentWorkspace {
  readonly descriptor: ComputerWorkspaceDescriptor
  private readonly rpc: ComputerRpcClient
  private computer: ComputerRow
  private localLeaseId?: string
  private ready = false
  private staged = false
  private toolsDisabled = false
  private idleTimeoutMs = 1_800_000

  constructor(private readonly options: ComputerWorkspaceOptions) {
    this.computer = options.computer
    this.descriptor = computerDescriptor(options.computer)
    this.rpc = options.rpc ?? computerRpc()
  }

  private get computerId(): string { return this.computer.id }
  private get computerName(): string { return this.computer.name }

  private leaseDetails(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { kind: 'computer', computerId: this.computerId, computerName: this.computerName, os: this.descriptor.os, accessMode: this.descriptor.accessMode, ...extra }
  }

  async ensureReady(signal?: AbortSignal): Promise<void> {
    if (this.ready) return
    signal?.throwIfAborted()
    try {
      this.computer = await loadRunnableComputer(this.computerId)
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'The selected computer is unavailable'
      await this.options.onLeaseEvent?.('unavailable', this.leaseDetails({ error: message }))
      throw new Error(message, { cause: error })
    }
    if (!await computerIsOnline(this.computerId)) {
      const message = `${this.computerName} is offline. Open the Pulpo desktop app on that computer and keep it running.`
      await this.options.onLeaseEvent?.('unavailable', this.leaseDetails({ error: message }))
      throw new Error(message)
    }
    const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    this.idleTimeoutMs = parseAgentSettings(settingsRow?.value).idleTimeoutSeconds * 1000
    const [existing] = await db.select().from(workspaceLeases).where(and(
      eq(workspaceLeases.chatId, this.options.chatId), eq(workspaceLeases.kind, 'computer'), eq(workspaceLeases.status, 'ready'),
    )).limit(1)
    const now = new Date()
    // A chat never mixes workspaces, but an abandoned sandbox lease would block the partial unique index.
    await db.update(workspaceLeases).set({ status: 'released', releasedAt: now, updatedAt: now })
      .where(and(eq(workspaceLeases.chatId, this.options.chatId), eq(workspaceLeases.kind, 'sandbox'), inArray(workspaceLeases.status, ['provisioning', 'ready'])))
    if (existing && existing.computerId === this.computerId) {
      this.localLeaseId = existing.id
      await db.update(workspaceLeases).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs), updatedAt: now }).where(eq(workspaceLeases.id, existing.id))
    } else {
      if (existing) await db.update(workspaceLeases).set({ status: 'released', releasedAt: now, updatedAt: now }).where(eq(workspaceLeases.id, existing.id))
      const id = newId()
      await db.insert(workspaceLeases).values({
        id, chatId: this.options.chatId, responseId: this.options.responseId, userId: this.options.userId, kind: 'computer', computerId: this.computerId,
        status: 'ready', claimedAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs),
      }).onConflictDoNothing()
      const [lease] = await db.select({ id: workspaceLeases.id }).from(workspaceLeases).where(and(
        eq(workspaceLeases.chatId, this.options.chatId), eq(workspaceLeases.kind, 'computer'), eq(workspaceLeases.status, 'ready'),
      )).limit(1)
      this.localLeaseId = lease?.id ?? id
    }
    this.ready = true
    if (!this.staged) await this.stageAttachments(signal)
    await this.options.onLeaseEvent?.('ready', this.leaseDetails({ reused: Boolean(existing && existing.computerId === this.computerId) }))
  }

  private async markOffline(reason: string): Promise<void> {
    this.ready = false
    this.staged = false
    if (this.localLeaseId) {
      await db.update(workspaceLeases).set({ status: 'expired', error: reason, updatedAt: new Date() }).where(eq(workspaceLeases.id, this.localLeaseId))
      this.localLeaseId = undefined
    }
    await this.options.onLeaseEvent?.('expired', this.leaseDetails({ error: reason }))
  }

  private async touchLease(): Promise<void> {
    if (!this.localLeaseId) return
    const now = new Date()
    await db.update(workspaceLeases).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs), updatedAt: now }).where(eq(workspaceLeases.id, this.localLeaseId))
  }

  /** Send one request, translating connectivity failures into a lease expiry the timeline can show. */
  private async send<K extends ComputerRequest['kind']>(request: Extract<ComputerRequest, { kind: K }>, signal?: AbortSignal, timeoutMs = RPC_TIMEOUT_MS) {
    try {
      return await this.rpc.request(this.computerId, request, { signal, timeoutMs })
    } catch (error) {
      if (error instanceof ComputerRpcError && (error.code === 'offline' || error.code === 'unreachable' || error.code === 'disabled')) {
        const reason = error.code === 'disabled'
          ? `${this.computerName} turned off agent access`
          : `${this.computerName} went offline`
        await this.markOffline(reason)
        throw new Error(`${reason} before the operation finished. Ask the user to reopen the Pulpo desktop app there, then try again.`, { cause: error })
      }
      throw error
    }
  }

  private async requireApproval(operationId: string, type: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string | undefined> {
    if (!toolApprovalRequired(type, this.descriptor.approvalPolicy)) return undefined
    const summary = toolApprovalSummary(type, args)
    const row = await createToolApproval({
      responseId: this.options.responseId, chatId: this.options.chatId, agentRunId: this.options.agentRunId, computerId: this.computerId,
      computerName: this.computerName, operationId, kind: type, summary,
    })
    if (row.status === 'approved') return row.id
    if (row.status === 'pending') await this.options.onApprovalEvent?.('requested', toolApprovalItem(row, this.computerName))
    const { outcome, row: decided } = row.status === 'pending'
      ? await waitForToolApproval(row.id, { signal, responseId: this.options.responseId })
      : { outcome: row.status as ApprovalOutcome, row }
    await this.options.onApprovalEvent?.(outcome, toolApprovalItem(decided, this.computerName))
    if (outcome === 'approved') return decided.id
    if (outcome === 'denied') throw new Error(`The user denied this action on ${this.computerName}: ${summary}`)
    if (outcome === 'expired') throw new Error(`The user did not approve this action within 5 minutes, so it was not run: ${summary}`)
    throw signal?.reason ?? new Error('Generation cancelled while waiting for approval')
  }

  async execute(
    operationId: string,
    type: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (output: string) => void,
    onStarted?: () => void | Promise<void>,
  ): Promise<WorkspaceOperation> {
    await this.ensureReady(signal)
    const approvalId = await this.requireApproval(operationId, type, args, signal)
    let operation: ComputerOperationSnapshot | null = await this.send({ kind: 'operation.start', id: operationId, type, args, ...(approvalId ? { approvalId } : {}) }, signal)
    await recordComputerAudit(this.options.userId, 'computer.operation', this.computerId, { operationId, type, responseId: this.options.responseId, summary: toolApprovalSummary(type, args).slice(0, 200) })
    await onStarted?.()
    let previousOutput = ''
    while (operation && operation.status === 'running') {
      if (signal?.aborted) { await this.cancel(operationId); throw signal.reason ?? new Error('Operation cancelled') }
      if (operation.output !== previousOutput) { previousOutput = operation.output; onUpdate?.(operation.output) }
      await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS))
      operation = await this.send({ kind: 'operation.status', id: operationId }, signal)
    }
    if (!operation) throw new Error(`${this.computerName} lost track of this operation; it may have restarted`)
    if (operation.output !== previousOutput) onUpdate?.(operation.output)
    await this.touchLease()
    if (operation.status === 'failed') throw new Error(operation.error ?? `${type} failed`)
    if (operation.status === 'cancelled') throw signal?.reason ?? new Error('Operation cancelled')
    return { id: operation.id, status: operation.status, output: operation.output, exitCode: operation.exitCode, error: operation.error, details: operation.details }
  }

  private async readRemoteFile(scope: 'export' | 'image', path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    const chunks: Buffer[] = []
    let offset = 0
    for (;;) {
      const part = await this.send({ kind: 'file.read', scope, path, offset, length: COMPUTER_FILE_CHUNK_BYTES, maxBytes }, signal)
      if (part.sizeBytes > maxBytes) throw new Error(`File exceeds the ${maxBytes} byte limit`)
      const chunk = Buffer.from(part.data, 'base64')
      chunks.push(chunk)
      offset += chunk.byteLength
      if (part.eof || chunk.byteLength === 0) break
      if (offset > maxBytes) throw new Error(`File exceeds the ${maxBytes} byte limit`)
    }
    return new Uint8Array(Buffer.concat(chunks))
  }

  async viewImage(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceImage> {
    await this.ensureReady(signal)
    await onStarted?.()
    const bytes = await this.readRemoteFile('image', path, MAX_VIEW_IMAGE_BYTES, signal)
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new Error('File is not a supported PNG, JPEG, GIF, or WebP image')
    await this.touchLease()
    return { data: Buffer.from(bytes).toString('base64'), mimeType, sizeBytes: bytes.byteLength }
  }

  async exportFile(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceFile> {
    await this.ensureReady(signal)
    await onStarted?.()
    const data = await this.readRemoteFile('export', path, MAX_EXPORT_FILE_BYTES, signal)
    await this.touchLease()
    return { data, sizeBytes: data.byteLength }
  }

  private async putFile(path: string, source: Readable, sizeBytes: number, checksum: string | null, signal?: AbortSignal): Promise<void> {
    const transferId = randomUUID()
    await this.send({ kind: 'file.begin', transferId, path, sizeBytes, checksum }, signal)
    try {
      let pending: Buffer[] = []
      let pendingBytes = 0
      const flush = async () => {
        if (!pendingBytes) return
        await this.send({ kind: 'file.chunk', transferId, data: Buffer.concat(pending).toString('base64') }, signal, 60_000)
        pending = []
        pendingBytes = 0
      }
      for await (const raw of source) {
        let chunk = Buffer.from(raw as Buffer)
        while (chunk.byteLength) {
          const room = COMPUTER_FILE_CHUNK_BYTES - pendingBytes
          const slice = chunk.subarray(0, room)
          pending.push(slice)
          pendingBytes += slice.byteLength
          chunk = chunk.subarray(slice.byteLength)
          if (pendingBytes >= COMPUTER_FILE_CHUNK_BYTES) await flush()
        }
      }
      await flush()
      await this.send({ kind: 'file.end', transferId }, signal, 60_000)
    } finally {
      source.destroy()
    }
  }

  private async stageAttachments(signal?: AbortSignal): Promise<void> {
    const rows = await db.select().from(attachments).where(and(
      eq(attachments.userId, this.options.userId), eq(attachments.chatId, this.options.chatId), eq(attachments.status, 'ready'),
    )).orderBy(asc(attachments.createdAt), asc(attachments.id))
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500).map((attachment) => ({ ...attachment, path: restoredAttachmentWorkspacePath(attachment, this.descriptor) }))
      if (!batch.length) continue
      const { missing } = await this.send({ kind: 'files.missing', files: batch.map(({ path, checksum, sizeBytes }) => ({ path, checksum, sizeBytes })) }, signal)
      const wanted = new Set(missing)
      for (const file of batch) {
        if (!wanted.has(file.path)) continue
        await this.putFile(file.path, await getBlobStore().getStream(file.objectKey), file.sizeBytes, file.checksum, signal)
      }
    }
    this.staged = true
  }

  async stageGeneratedAttachment(attachmentId: string, signal?: AbortSignal): Promise<void> {
    if (!this.ready) { this.staged = false; return }
    const [attachment] = await db.select().from(attachments).where(and(
      eq(attachments.id, attachmentId), eq(attachments.userId, this.options.userId), eq(attachments.chatId, this.options.chatId), eq(attachments.status, 'ready'),
    )).limit(1)
    if (!attachment) throw new Error('Generated attachment is unavailable')
    await this.putFile(restoredAttachmentWorkspacePath(attachment, this.descriptor), await getBlobStore().getStream(attachment.objectKey), attachment.sizeBytes, attachment.checksum, signal)
  }

  async cancel(operationId: string): Promise<void> {
    if (!this.ready) return
    await this.rpc.request(this.computerId, { kind: 'operation.cancel', id: operationId }, { timeoutMs: 10_000 }).catch(() => undefined)
  }

  get leaseId(): string | undefined { return this.localLeaseId }
  get continuedWithoutAgent(): boolean { return this.toolsDisabled }
  disableTools(): void { this.toolsDisabled = true }
}

/** Release every active computer lease for a chat, e.g. when the chat is deleted. */
export async function releaseComputerLeasesForChat(chatId: string): Promise<void> {
  await db.update(workspaceLeases).set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workspaceLeases.chatId, chatId), eq(workspaceLeases.kind, 'computer'), inArray(workspaceLeases.status, ['provisioning', 'ready'])))
}
