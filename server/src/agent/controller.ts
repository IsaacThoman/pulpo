import { and, asc, eq, inArray } from 'drizzle-orm'
import { parseAgentSettings } from '../settings/application-settings.js'
import { applicationSettings, attachments, responses, workspaceLeases } from '../database/schema.js'
import { db } from '../database/client.js'
import { getConfig } from '../config.js'
import { getBlobStore } from '../storage/index.js'
import { newId } from '../lib/ids.js'
import { attachmentWorkspacePath } from './policy.js'
import { isWorkspaceCapacityResponse, workspaceQueuePosition } from './capacity.js'

export interface WorkspaceOperation {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  error?: string
}

class ControllerRequestError extends Error {
  constructor(readonly status: number, readonly responseBody: string) {
    super(`Workspace controller request failed (${status}): ${responseBody}`)
  }
}

function isCapacityError(error: unknown): boolean {
  return error instanceof ControllerRequestError && isWorkspaceCapacityResponse(error.status, error.responseBody)
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export class WorkspaceManager {
  private controllerLeaseId?: string
  private localLeaseId?: string
  private staged = false
  private idleTimeoutMs = 1_800_000
  private toolsDisabled = false

  constructor(
    private readonly responseId: string,
    private readonly chatId: string,
    private readonly userId: string,
    private readonly onLeaseEvent?: (state: 'waiting' | 'provisioning' | 'ready' | 'expired' | 'unavailable' | 'continuing_without_agent', details?: Record<string, unknown>) => Promise<void>,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const config = getConfig()
    if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) throw new Error('Workspace controller is not configured')
    const response = await fetch(`${config.WORKSPACE_CONTROLLER_URL.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${config.WORKSPACE_CONTROLLER_TOKEN}`, ...(init.headers ?? {}) },
    })
    if (!response.ok) throw new ControllerRequestError(response.status, await response.text())
    return response
  }

  async ensureLease(signal?: AbortSignal): Promise<string> {
    if (this.controllerLeaseId) return this.controllerLeaseId
    let [existing] = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.chatId, this.chatId), inArray(workspaceLeases.status, ['provisioning', 'ready']))).limit(1)
    if (existing?.status === 'ready' && (!existing.controllerLeaseId || (existing.hardExpiresAt && existing.hardExpiresAt <= new Date()) || (existing.expiresAt && existing.expiresAt <= new Date()))) {
      await db.update(workspaceLeases).set({ status: 'expired', error: 'Workspace lease expired before reuse', updatedAt: new Date() }).where(eq(workspaceLeases.id, existing.id))
      existing = undefined
    }
    if (existing?.controllerLeaseId && existing.status === 'ready' && (!existing.hardExpiresAt || existing.hardExpiresAt > new Date()) && (!existing.expiresAt || existing.expiresAt > new Date())) {
      this.localLeaseId = existing.id; this.controllerLeaseId = existing.controllerLeaseId
      if (existing.expiresAt && existing.lastUsedAt) this.idleTimeoutMs = Math.max(60_000, existing.expiresAt.getTime() - existing.lastUsedAt.getTime())
      await this.onLeaseEvent?.('ready', { reused: true })
    } else {
      const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
      const settings = parseAgentSettings(settingsRow?.value)
      this.idleTimeoutMs = settings.idleTimeoutSeconds * 1000
      const id = existing?.id ?? newId()
      if (!existing) {
        await db.insert(workspaceLeases).values({ id, responseId: this.responseId, chatId: this.chatId, userId: this.userId, imageDigest: settings.imageDigest, status: 'provisioning', capacityState: 'waiting' }).onConflictDoNothing()
        ;[existing] = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.chatId, this.chatId), inArray(workspaceLeases.status, ['provisioning', 'ready']))).limit(1)
      }
      if (!existing) throw new Error('Unable to create workspace queue record')
      const queueLease = existing
      this.localLeaseId = queueLease.id
      if (queueLease.status === 'provisioning' && queueLease.capacityState !== 'waiting' && (!queueLease.responseId || queueLease.responseId === this.responseId)) {
        await db.update(workspaceLeases).set({ responseId: this.responseId, capacityState: 'waiting', updatedAt: new Date() }).where(eq(workspaceLeases.id, queueLease.id))
      }
      const deadline = queueLease.createdAt.getTime() + settings.workspaceWaitTimeoutSeconds * 1000
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
        if (current?.status === 'ready' && current.controllerLeaseId) {
          this.controllerLeaseId = current.controllerLeaseId
          await this.onLeaseEvent?.('ready', { reused: current.responseId !== this.responseId })
          break
        }
        if (Date.now() >= deadline) {
          const message = `No workspace became available within ${settings.workspaceWaitTimeoutSeconds} seconds`
          await db.update(workspaceLeases).set({ status: 'failed', capacityState: null, error: message, updatedAt: new Date() }).where(eq(workspaceLeases.id, queueLease.id))
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
          await this.onLeaseEvent?.('waiting', { position: Math.max(1, position), waitTimeoutSeconds: settings.workspaceWaitTimeoutSeconds })
        }
        if (position !== 1) { await wait(1_000); continue }
        const [claimedQueueRow] = await db.update(workspaceLeases).set({ capacityState: 'claiming', updatedAt: new Date() })
          .where(and(eq(workspaceLeases.id, queueLease.id), eq(workspaceLeases.status, 'provisioning'), eq(workspaceLeases.capacityState, 'waiting'))).returning({ id: workspaceLeases.id })
        if (!claimedQueueRow) { await wait(500); continue }
        await this.onLeaseEvent?.('provisioning')
        try {
          const controllerResponse = await this.request('/v1/leases', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId: this.chatId, imageDigest: settings.imageDigest, warmCapacity: settings.warmCapacity, maxActiveWorkspaces: settings.maxActiveWorkspaces, idleTimeoutSeconds: settings.idleTimeoutSeconds, hardTimeoutSeconds: settings.hardTimeoutSeconds, resources: { cpu: settings.cpu, memory: settings.memory, ephemeralStorage: settings.ephemeralStorage } }) })
          const lease = await controllerResponse.json() as { id: string }
          const now = new Date(); this.controllerLeaseId = lease.id
          await db.update(workspaceLeases).set({ controllerLeaseId: lease.id, status: 'ready', capacityState: null, claimedAt: now, lastUsedAt: now, hardExpiresAt: new Date(now.getTime() + settings.hardTimeoutSeconds * 1000), expiresAt: new Date(now.getTime() + settings.idleTimeoutSeconds * 1000), updatedAt: now }).where(eq(workspaceLeases.id, queueLease.id))
          await this.onLeaseEvent?.('ready', { reused: false })
        } catch (error) {
          if (isCapacityError(error)) {
            await db.update(workspaceLeases).set({ capacityState: 'waiting', error: null, updatedAt: new Date() }).where(eq(workspaceLeases.id, queueLease.id))
            await this.onLeaseEvent?.('waiting', { position: 1, waitTimeoutSeconds: settings.workspaceWaitTimeoutSeconds })
            await wait(1_000)
            continue
          }
          await db.update(workspaceLeases).set({ status: 'failed', capacityState: null, error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(workspaceLeases.id, queueLease.id))
          await this.onLeaseEvent?.('unavailable', { error: error instanceof Error ? error.message : String(error) })
          throw error
        }
      }
    }
    if (!this.staged) await this.stageAttachments()
    return this.controllerLeaseId!
  }

  private async stageAttachments(): Promise<void> {
    if (!this.controllerLeaseId) return
    const [record] = await db.select({ input: responses.input }).from(responses).where(eq(responses.id, this.responseId)).limit(1)
    const ids = (Array.isArray(record?.input) ? record.input : []).flatMap((item) => {
      const content = (item as { content?: unknown }).content
      return Array.isArray(content) ? content.flatMap((part) => (part as { attachment_id?: string }).attachment_id ? [(part as { attachment_id: string }).attachment_id] : []) : []
    })
    if (!ids.length) { this.staged = true; return }
    const rows = await db.select().from(attachments).where(and(eq(attachments.userId, this.userId), inArray(attachments.id, ids), eq(attachments.status, 'ready')))
    for (const attachment of rows) {
      const path = attachmentWorkspacePath(attachment.originalName, attachment.id)
      await this.request(`/v1/leases/${this.controllerLeaseId}/v1/files?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'content-type': attachment.mimeType }, body: new Uint8Array(await getBlobStore().get(attachment.objectKey)) })
    }
    this.staged = true
  }

  async execute(operationId: string, type: string, args: Record<string, unknown>, signal?: AbortSignal, onUpdate?: (output: string) => void): Promise<WorkspaceOperation> {
    let leaseId = await this.ensureLease(signal)
    const init = { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: operationId, type, args }) }
    let response: Response
    try { response = await this.request(`/v1/leases/${leaseId}/v1/operations`, init) } catch (error) {
      if (signal?.aborted) { await this.cancel(operationId); throw error }
      if (!(error instanceof Error) || !error.message.includes('(404)')) throw error
      if (this.localLeaseId) await db.update(workspaceLeases).set({ status: 'expired', error: 'Controller lease expired', updatedAt: new Date() }).where(eq(workspaceLeases.id, this.localLeaseId))
      await this.onLeaseEvent?.('expired')
      this.localLeaseId = undefined; this.controllerLeaseId = undefined; this.staged = false
      leaseId = await this.ensureLease(signal)
      response = await this.request(`/v1/leases/${leaseId}/v1/operations`, init)
    }
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

  async cancel(operationId: string): Promise<void> {
    if (!this.controllerLeaseId) return
    await this.request(`/v1/leases/${this.controllerLeaseId}/v1/operations/${operationId}/cancel`, { method: 'POST' }).catch(() => undefined)
  }

  get leaseId(): string | undefined { return this.localLeaseId }
  get continuedWithoutAgent(): boolean { return this.toolsDisabled }
}

export async function releaseWorkspaceForChat(chatId: string): Promise<void> {
  const [lease] = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.chatId, chatId), inArray(workspaceLeases.status, ['provisioning', 'ready']))).limit(1)
  if (!lease) return
  const config = getConfig()
  if (lease.controllerLeaseId && config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN) {
    await fetch(`${config.WORKSPACE_CONTROLLER_URL.replace(/\/$/, '')}/v1/leases/${lease.controllerLeaseId}`, { method: 'DELETE', headers: { authorization: `Bearer ${config.WORKSPACE_CONTROLLER_TOKEN}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }
  await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: new Date(), updatedAt: new Date() }).where(eq(workspaceLeases.id, lease.id))
}
