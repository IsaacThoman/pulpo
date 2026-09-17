import { stageWorkspaceAttachments } from './stage-attachments.js'
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { parseAgentSettings } from '../settings/application-settings.js'
import { applicationSettings, attachments, chats, responses, workspaceLeases } from '../database/schema.js'
import { db } from '../database/client.js'
import { getConfig } from '../config.js'
import { getBlobStore } from '../storage/index.js'
import { newId } from '../lib/ids.js'
import { workspaceAttachments } from './workspace-attachments.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { workspaceContinueWithoutAgentAvailableAt, workspaceQueuePosition } from './capacity.js'
import { workspaceControllerRequest } from './controller-http.js'
import type { RequestInit } from 'undici'
import { detectImageMime } from './images.js'
import { attemptWorkspaceLease, ControllerRequestError } from './lease-acquisition.js'

const MAX_VIEW_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_EXPORT_FILE_BYTES = 25 * 1024 * 1024

export interface WorkspaceOperation {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  error?: string
  details?: Record<string, unknown>
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

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export class WorkspaceManager {
  private controllerLeaseId?: string
  private localLeaseId?: string
  private staged = false
  private acquisition?: Promise<string>
  private scopeId?: string
  private workspaceNotice = ''
  private idleTimeoutMs = 1_800_000
  private toolsDisabled = false
  private capacityReservationsSupported?: boolean

  private async scope(): Promise<string> {
    if (!this.scopeId) {
      const [response] = await db.select({ scopeId: responses.workspaceScopeId }).from(responses)
        .where(and(eq(responses.id, this.responseId), eq(responses.chatId, this.chatId), eq(responses.userId, this.userId))).limit(1)
      if (!response) throw new Error('Workspace response is unavailable')
      this.scopeId = response.scopeId
    }
    return this.scopeId
  }

  /** Describe the environment before inference without provisioning a pod. */
  async contextNotice(): Promise<string> {
    if (this.workspaceNotice) return this.workspaceNotice
    const scopeId = await this.scope()
    const [lease] = await db.select().from(workspaceLeases).where(and(
      eq(workspaceLeases.workspaceScopeId, scopeId), eq(workspaceLeases.chatId, this.chatId), eq(workspaceLeases.userId, this.userId), eq(workspaceLeases.status, 'ready'),
    )).limit(1)
    if (lease?.controllerLeaseId && (!lease.expiresAt || lease.expiresAt > new Date()) && (!lease.hardExpiresAt || lease.hardExpiresAt > new Date())) {
      return '[Pulpo workspace context] Continuing the workspace for this execution history. Inspect files before relying on historical tool results.'
    }
    return this.resetNotice(await this.attachmentManifest())
  }

  private resetNotice(files: Array<{ path: string }>): string {
    return `[Pulpo workspace context] This execution has a fresh workspace. Historical tool results describe an earlier environment. Scratch files, installed packages, and background processes are not restored. Saved files available on first workspace access:\n${files.length ? files.map(file => JSON.stringify(file.path)).join('\n') : '(none)'}`
  }

  private async attachmentManifest() {
    const turns = await db.select().from(responses).where(and(
      eq(responses.chatId, this.chatId), eq(responses.userId, this.userId), isNull(responses.deletedAt),
    )).orderBy(asc(responses.createdAt), asc(responses.id))
    const lineage = lineageFromLeaf(turns, this.responseId)
    const rows = await db.select().from(attachments).where(and(
      eq(attachments.userId, this.userId), eq(attachments.chatId, this.chatId), eq(attachments.status, 'ready'),
    )).orderBy(asc(attachments.createdAt), asc(attachments.id))
    return workspaceAttachments(lineage, rows)
  }

  constructor(
    private readonly responseId: string,
    private readonly chatId: string,
    private readonly userId: string,
    private readonly onLeaseEvent?: (state: 'waiting' | 'provisioning' | 'ready' | 'expired' | 'unavailable' | 'continuing_without_agent', details?: Record<string, unknown>) => Promise<void>,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const config = getConfig()
    if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) throw new Error('Workspace controller is not configured')
    const response = await workspaceControllerRequest(path, {
      ...init,
      headers: init.headers,
    })
    if (!response.ok) throw new ControllerRequestError(response.status, await response.text())
    return response
  }

  async ensureLease(signal?: AbortSignal): Promise<string> {
    if (this.acquisition) return this.acquisition
    this.acquisition = this.acquireLease(signal)
    try { return await this.acquisition } finally { this.acquisition = undefined }
  }

  private async acquireLease(signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw signal.reason ?? new Error('Generation cancelled')
    if (this.controllerLeaseId && this.staged) return this.controllerLeaseId
    const scopeId = await this.scope()
    const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    const settings = parseAgentSettings(settingsRow?.value)
    const existing = await db.transaction(async tx => {
      const [chat] = await tx.select({ id: chats.id }).from(chats).where(and(
        eq(chats.id, this.chatId), eq(chats.userId, this.userId), isNull(chats.deletedAt), isNull(chats.purgeStartedAt), accessibleChatCondition(),
      )).for('update')
      if (!chat) throw new Error('Workspace chat is unavailable')
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scopeId}, 0))`)
      let [lease] = await tx.select().from(workspaceLeases).where(and(
        eq(workspaceLeases.workspaceScopeId, scopeId), eq(workspaceLeases.chatId, this.chatId), eq(workspaceLeases.userId, this.userId), inArray(workspaceLeases.status, ['provisioning', 'ready']),
      )).limit(1)
      if (lease?.status === 'ready' && (!lease.controllerLeaseId || (lease.hardExpiresAt && lease.hardExpiresAt <= new Date()) || (lease.expiresAt && lease.expiresAt <= new Date()))) {
        await tx.update(workspaceLeases).set({ status: 'expired', error: 'Workspace lease expired before reuse', updatedAt: new Date() }).where(eq(workspaceLeases.id, lease.id))
        lease = undefined
      }
      if (!lease) {
        ;[lease] = await tx.insert(workspaceLeases).values({
          id: newId(), workspaceScopeId: scopeId, responseId: this.responseId, chatId: this.chatId,
          userId: this.userId, imageDigest: settings.imageDigest, status: 'provisioning', capacityState: 'waiting',
        }).returning()
      }
      if (!lease) throw new Error('Unable to create workspace queue record')
      return lease
    })
    let reused = false
    if (existing?.controllerLeaseId && existing.status === 'ready' && (!existing.hardExpiresAt || existing.hardExpiresAt > new Date()) && (!existing.expiresAt || existing.expiresAt > new Date())) {
      reused = true
      this.localLeaseId = existing.id; this.controllerLeaseId = existing.controllerLeaseId
      if (existing.expiresAt && existing.lastUsedAt) this.idleTimeoutMs = Math.max(60_000, existing.expiresAt.getTime() - existing.lastUsedAt.getTime())
      await this.onLeaseEvent?.('ready', { reused: true })
    } else {
      this.idleTimeoutMs = settings.idleTimeoutSeconds * 1000
      const queueLease = existing
      this.localLeaseId = queueLease.id
      const deadline = queueLease.createdAt.getTime() + settings.workspaceWaitTimeoutSeconds * 1000
      const continueWithoutAgentAvailableAt = workspaceContinueWithoutAgentAvailableAt(queueLease.createdAt).toISOString()
      let lastPosition = -1
      while (!this.controllerLeaseId) {
        if (signal?.aborted) {
          await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: new Date(), error: 'Response stopped while waiting for workspace capacity', updatedAt: new Date() }).where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning')))
          throw signal.reason ?? new Error('Generation cancelled')
        }
        const [responseState] = await db.select({ status: responses.status, action: responses.agentCapacityAction }).from(responses).where(eq(responses.id, this.responseId)).limit(1)
        if (!responseState || responseState.status === 'cancelled') {
          await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: new Date(), error: 'Response cancelled while waiting for workspace capacity', updatedAt: new Date() }).where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning')))
          throw new Error('Generation cancelled')
        }
        if (responseState.action === 'continue_without_agent') {
          this.toolsDisabled = true
          await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: new Date(), error: 'User continued without agent tools', updatedAt: new Date() }).where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning')))
          await this.onLeaseEvent?.('continuing_without_agent')
          throw new Error('Workspace tool skipped because the user chose to continue without agent tools')
        }
        const [current] = await db.select().from(workspaceLeases).where(eq(workspaceLeases.id, queueLease.id)).limit(1)
        if (!current || !['provisioning', 'ready'].includes(current.status)) throw new Error('Workspace acquisition is no longer active')
        if (current.status === 'ready' && current.controllerLeaseId) {
          reused = true
          this.controllerLeaseId = current.controllerLeaseId
          await this.onLeaseEvent?.('ready', { reused: current.responseId !== this.responseId })
          break
        }
        if (Date.now() >= deadline) {
          const message = `No workspace became available within ${settings.workspaceWaitTimeoutSeconds} seconds`
          await db.update(workspaceLeases).set({ status: 'failed', capacityState: null, error: message, updatedAt: new Date() }).where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning')))
          await this.onLeaseEvent?.('unavailable', { error: message })
          throw new Error(message)
        }
        const queued = await db.select({ id: workspaceLeases.id }).from(workspaceLeases)
          .innerJoin(responses, eq(workspaceLeases.responseId, responses.id))
          .where(and(eq(workspaceLeases.status, 'provisioning'), inArray(workspaceLeases.capacityState, ['waiting', 'claiming']), inArray(responses.status, ['queued', 'in_progress'])))
          .orderBy(asc(workspaceLeases.createdAt), asc(workspaceLeases.id))
        const position = workspaceQueuePosition(queued.map((entry) => entry.id), queueLease.id)
        if (position !== lastPosition) {
          lastPosition = position
          await this.onLeaseEvent?.('waiting', { position: Math.max(1, position), waitTimeoutSeconds: settings.workspaceWaitTimeoutSeconds, continueWithoutAgentAvailableAt })
        }
        if (position !== 1) { await wait(1_000); continue }
        const [claimedQueueRow] = await db.update(workspaceLeases).set({ capacityState: 'claiming', updatedAt: new Date() })
          .where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning'), eq(workspaceLeases.capacityState, 'waiting'))).returning({ id: workspaceLeases.id })
        if (!claimedQueueRow) { await wait(500); continue }
        let acquiredControllerLeaseId: string | undefined
        try {
          const attempt = await attemptWorkspaceLease({
            request: (path, init) => this.request(path, init),
            signal,
            capacityReservationsSupported: this.capacityReservationsSupported,
            maxActiveWorkspaces: settings.maxActiveWorkspaces,
            leaseInput: {
              chatId: this.chatId,
              imageDigest: settings.imageDigest,
              warmCapacity: settings.warmCapacity,
              maxActiveWorkspaces: settings.maxActiveWorkspaces,
              idleTimeoutSeconds: settings.idleTimeoutSeconds,
              hardTimeoutSeconds: settings.hardTimeoutSeconds,
              resources: { cpu: settings.cpu, memory: settings.memory, ephemeralStorage: settings.ephemeralStorage },
            },
            onProvisioning: async () => { await this.onLeaseEvent?.('provisioning') },
          })
          this.capacityReservationsSupported = attempt.capacityReservationsSupported
          if (attempt.kind === 'waiting') {
            await db.update(workspaceLeases).set({ capacityState: 'waiting', error: null, updatedAt: new Date() }).where(eq(workspaceLeases.id, queueLease.id))
            if (attempt.publicStateChanged) await this.onLeaseEvent?.('waiting', { position: 1, waitTimeoutSeconds: settings.workspaceWaitTimeoutSeconds, continueWithoutAgentAvailableAt })
            await wait(1_000)
            continue
          }
          acquiredControllerLeaseId = attempt.leaseId
          this.controllerLeaseId = attempt.leaseId
          // Publish readiness only after restoration, so another manager cannot run tools
          // while this manager is still writing initial saved versions.
          await this.stageAttachments(false)
          const now = new Date()
          const [published] = await db.update(workspaceLeases).set({ controllerLeaseId: attempt.leaseId, status: 'ready', capacityState: null, claimedAt: now, lastUsedAt: now, hardExpiresAt: new Date(now.getTime() + settings.hardTimeoutSeconds * 1000), expiresAt: new Date(now.getTime() + settings.idleTimeoutSeconds * 1000), updatedAt: now })
            .where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning'), eq(workspaceLeases.capacityState, 'claiming'))).returning({ id: workspaceLeases.id })
          if (!published) throw new Error('Workspace acquisition was cancelled')
          await this.onLeaseEvent?.('ready', { reused: false })
        } catch (error) {
          if (acquiredControllerLeaseId) {
            await this.request(`/v1/leases/${acquiredControllerLeaseId}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
            this.controllerLeaseId = undefined; this.staged = false; this.workspaceNotice = ''
          }
          await db.update(workspaceLeases).set({ status: 'failed', capacityState: null, error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning')))
          await this.onLeaseEvent?.('unavailable', { error: error instanceof Error ? error.message : String(error) })
          throw error
        }
      }
    }
    if (!this.staged) await this.stageAttachments(reused)
    return this.controllerLeaseId!
  }

  private async stageAttachments(reused: boolean): Promise<void> {
    if (!this.controllerLeaseId) return
    const files = await this.attachmentManifest()
    await stageWorkspaceAttachments(files,
      (path, init) => this.request(`/v1/leases/${this.controllerLeaseId}${path}`, init),
      (key) => getBlobStore().getStream(key), { preserveExisting: reused })
    this.workspaceNotice = reused
      ? '[Pulpo workspace context] Continuing the workspace for this execution history. Existing working files were preserved. Available saved-file paths:\n' + files.map(file => JSON.stringify(file.path)).join('\n')
      : this.resetNotice(files)
    this.staged = true
  }

  /** Save generated bytes to the lease acquired before the provider call. Never create a replacement lease here. */
  async saveGeneratedFile(path: string, data: Uint8Array, mimeType: string, leaseId: string, signal?: AbortSignal): Promise<void> {
    if (!path.startsWith('/workspace/') || data.byteLength > MAX_EXPORT_FILE_BYTES) throw new Error('Generated workspace file is invalid')
    if (this.toolsDisabled || this.controllerLeaseId !== leaseId) throw new Error('The original image workspace is unavailable')
    const response = await this.request(`/v1/leases/${leaseId}/v1/files?path=${encodeURIComponent(path)}`, {
      method: 'PUT', signal, headers: { 'content-type': mimeType, 'content-length': String(data.byteLength) }, body: Buffer.from(data),
    })
    await response.arrayBuffer()
    if (this.localLeaseId) {
      const now = new Date()
      await db.update(workspaceLeases).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs), updatedAt: now }).where(eq(workspaceLeases.id, this.localLeaseId))
    }
  }

  /** Recovery must inspect the original authorized lease without provisioning a new workspace. */
  async readGeneratedFile(path: string, leaseId: string, signal?: AbortSignal): Promise<WorkspaceFile> {
    if (!path.startsWith('/workspace/')) throw new Error('Generated files must be inside /workspace')
    const [lease] = await db.select({ id: workspaceLeases.id }).from(workspaceLeases)
      .where(and(eq(workspaceLeases.chatId, this.chatId), eq(workspaceLeases.userId, this.userId), eq(workspaceLeases.controllerLeaseId, leaseId), eq(workspaceLeases.workspaceScopeId, await this.scope()), eq(workspaceLeases.status, 'ready'))).limit(1)
    if (!lease) throw new Error('The original image workspace is unavailable')
    const response = await this.request(`/v1/leases/${leaseId}/v1/files?path=${encodeURIComponent(path)}`, { signal: signal ?? AbortSignal.timeout(10_000) })
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > MAX_EXPORT_FILE_BYTES) throw new Error('Generated file exceeds the export limit')
    return { data, sizeBytes: data.byteLength }
  }

  async execute(
    operationId: string,
    type: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (output: string) => void,
    onStarted?: () => void | Promise<void>,
  ): Promise<WorkspaceOperation> {
    let leaseId = await this.ensureLease(signal)
    const init = { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: operationId, type, args }) }
    let response: Response
    try { response = await this.request(`/v1/leases/${leaseId}/v1/operations`, init) } catch (error) {
      if (signal?.aborted) { await this.cancel(operationId); throw error }
      if (!(error instanceof Error) || !error.message.includes('(404)')) throw error
      if (this.localLeaseId) await db.update(workspaceLeases).set({ status: 'expired', error: 'Controller lease expired', updatedAt: new Date() }).where(eq(workspaceLeases.id, this.localLeaseId))
      await this.onLeaseEvent?.('expired')
      this.localLeaseId = undefined; this.controllerLeaseId = undefined; this.staged = false; this.workspaceNotice = ''
      leaseId = await this.ensureLease(signal)
      response = await this.request(`/v1/leases/${leaseId}/v1/operations`, init)
    }
    await onStarted?.()
    let operation = await response.json() as WorkspaceOperation
    let previousOutput = ''
    while (operation.status === 'running') {
      if (signal?.aborted) { await this.cancel(operationId); throw signal.reason ?? new Error('Operation cancelled') }
      if (operation.output !== previousOutput) { previousOutput = operation.output; onUpdate?.(operation.output) }
      await new Promise((resolve) => setTimeout(resolve, 250))
      operation = await (await this.request(`/v1/leases/${leaseId}/v1/operations/${operationId}`, { signal })).json() as WorkspaceOperation
    }
    if (operation.output !== previousOutput) onUpdate?.(operation.output)
    if (this.localLeaseId) { const now = new Date(); await db.update(workspaceLeases).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs), updatedAt: now }).where(eq(workspaceLeases.id, this.localLeaseId)) }
    if (operation.status === 'failed') throw new Error(operation.error ?? `${type} failed`)
    return operation
  }

  async viewImage(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceImage> {
    if (!path.startsWith('/')) throw new Error('Image path must be absolute')
    let leaseId = await this.ensureLease(signal)
    let response: Response
    try {
      response = await this.request(`/v1/leases/${leaseId}/v1/images?path=${encodeURIComponent(path)}`, { signal })
    } catch (error) {
      if (signal?.aborted || !(error instanceof ControllerRequestError) || error.status !== 404) throw error
      if (this.localLeaseId) await db.update(workspaceLeases).set({ status: 'expired', error: 'Controller lease expired', updatedAt: new Date() }).where(eq(workspaceLeases.id, this.localLeaseId))
      await this.onLeaseEvent?.('expired')
      this.localLeaseId = undefined; this.controllerLeaseId = undefined; this.staged = false; this.workspaceNotice = ''
      leaseId = await this.ensureLease(signal)
      response = await this.request(`/v1/leases/${leaseId}/v1/images?path=${encodeURIComponent(path)}`, { signal })
    }
    await onStarted?.()
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_VIEW_IMAGE_BYTES) throw new Error(`Image exceeds the ${MAX_VIEW_IMAGE_BYTES} byte limit`)
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new Error('File is not a supported PNG, JPEG, GIF, or WebP image')
    if (this.localLeaseId) {
      const now = new Date()
      await db.update(workspaceLeases).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs), updatedAt: now }).where(eq(workspaceLeases.id, this.localLeaseId))
    }
    return { data: Buffer.from(bytes).toString('base64'), mimeType, sizeBytes: bytes.byteLength }
  }

  async exportFile(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceFile> {
    if (!path.startsWith('/workspace/')) throw new Error('Attached files must be inside /workspace')
    let leaseId = await this.ensureLease(signal)
    let response: Response
    try {
      response = await this.request(`/v1/leases/${leaseId}/v1/files?path=${encodeURIComponent(path)}`, { signal })
    } catch (error) {
      if (signal?.aborted || !(error instanceof ControllerRequestError) || error.status !== 404) throw error
      if (this.localLeaseId) await db.update(workspaceLeases).set({ status: 'expired', error: 'Controller lease expired', updatedAt: new Date() }).where(eq(workspaceLeases.id, this.localLeaseId))
      await this.onLeaseEvent?.('expired')
      this.localLeaseId = undefined; this.controllerLeaseId = undefined; this.staged = false; this.workspaceNotice = ''
      leaseId = await this.ensureLease(signal)
      response = await this.request(`/v1/leases/${leaseId}/v1/files?path=${encodeURIComponent(path)}`, { signal })
    }
    await onStarted?.()
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > MAX_EXPORT_FILE_BYTES) throw new Error(`File exceeds the ${MAX_EXPORT_FILE_BYTES} byte limit`)
    if (this.localLeaseId) {
      const now = new Date()
      await db.update(workspaceLeases).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + this.idleTimeoutMs), updatedAt: now }).where(eq(workspaceLeases.id, this.localLeaseId))
    }
    return { data, sizeBytes: data.byteLength }
  }

  async cancel(operationId: string): Promise<void> {
    if (!this.controllerLeaseId) return
    await this.request(`/v1/leases/${this.controllerLeaseId}/v1/operations/${operationId}/cancel`, { method: 'POST' }).catch(() => undefined)
  }

  get leaseId(): string | undefined { return this.localLeaseId }
  get continuedWithoutAgent(): boolean { return this.toolsDisabled }
  disableTools(): void { this.toolsDisabled = true }
}

export async function releaseWorkspaceForChat(chatId: string): Promise<void> {
  const leases = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.chatId, chatId), inArray(workspaceLeases.status, ['provisioning', 'ready'])))
  const config = getConfig()
  for (const lease of leases) {
    await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: new Date(), updatedAt: new Date() }).where(eq(workspaceLeases.id, lease.id))
    if (lease.controllerLeaseId && config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN) {
      await workspaceControllerRequest(`/v1/leases/${lease.controllerLeaseId}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
    }
  }
}

/** Mark DB leases expired when timers elapsed or the controller no longer holds them. */
export async function reconcileWorkspaceLeases(): Promise<void> {
  const now = new Date()
  await db.update(workspaceLeases).set({
    status: 'expired', capacityState: null, error: 'Workspace lease expired', updatedAt: now,
  }).where(and(
    eq(workspaceLeases.status, 'ready'),
    or(
      and(isNotNull(workspaceLeases.expiresAt), lte(workspaceLeases.expiresAt, now)),
      and(isNotNull(workspaceLeases.hardExpiresAt), lte(workspaceLeases.hardExpiresAt, now)),
    ),
  ))

  const config = getConfig()
  if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) return
  try {
    const response = await workspaceControllerRequest('/v1/leases', { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return
    const body = await response.json() as { leases?: Array<{ id: string }> }
    const active = new Set((body.leases ?? []).map((lease) => lease.id))
    const ready = await db.select({ id: workspaceLeases.id, controllerLeaseId: workspaceLeases.controllerLeaseId })
      .from(workspaceLeases).where(eq(workspaceLeases.status, 'ready'))
    const stale = ready.filter((row) => !row.controllerLeaseId || !active.has(row.controllerLeaseId)).map((row) => row.id)
    if (!stale.length) return
    await db.update(workspaceLeases).set({
      status: 'expired', capacityState: null, error: 'Controller lease no longer active', updatedAt: now,
    }).where(inArray(workspaceLeases.id, stale))
  } catch {
    // Controller unreachable: keep time-based expiry only so a blip does not wipe live rows.
  }
}
