import { and, eq, inArray } from 'drizzle-orm'
import { parseAgentSettings } from '../settings/application-settings.js'
import { applicationSettings, attachments, responses, workspaceLeases } from '../database/schema.js'
import { db } from '../database/client.js'
import { getConfig } from '../config.js'
import { getBlobStore } from '../storage/index.js'
import { newId } from '../lib/ids.js'
import { attachmentWorkspacePath } from './policy.js'

export interface WorkspaceOperation {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  error?: string
}

export class WorkspaceManager {
  private controllerLeaseId?: string
  private localLeaseId?: string
  private staged = false
  private idleTimeoutMs = 3_600_000

  constructor(
    private readonly responseId: string,
    private readonly chatId: string,
    private readonly userId: string,
    private readonly onLeaseEvent?: (state: 'provisioning' | 'ready' | 'expired' | 'unavailable', details?: Record<string, unknown>) => Promise<void>,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const config = getConfig()
    if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) throw new Error('Workspace controller is not configured')
    const response = await fetch(`${config.WORKSPACE_CONTROLLER_URL.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${config.WORKSPACE_CONTROLLER_TOKEN}`, ...(init.headers ?? {}) },
    })
    if (!response.ok) throw new Error(`Workspace controller request failed (${response.status}): ${await response.text()}`)
    return response
  }

  async ensureLease(): Promise<string> {
    if (this.controllerLeaseId) return this.controllerLeaseId
    const [existing] = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.chatId, this.chatId), inArray(workspaceLeases.status, ['provisioning', 'ready']))).limit(1)
    if (existing?.controllerLeaseId && existing.status === 'ready' && (!existing.hardExpiresAt || existing.hardExpiresAt > new Date()) && (!existing.expiresAt || existing.expiresAt > new Date())) {
      this.localLeaseId = existing.id; this.controllerLeaseId = existing.controllerLeaseId
      if (existing.expiresAt && existing.lastUsedAt) this.idleTimeoutMs = Math.max(60_000, existing.expiresAt.getTime() - existing.lastUsedAt.getTime())
      await this.onLeaseEvent?.('ready', { reused: true })
    } else {
      const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
      const settings = parseAgentSettings(settingsRow?.value)
      this.idleTimeoutMs = settings.idleTimeoutSeconds * 1000
      const id = newId(); const now = new Date()
      await db.insert(workspaceLeases).values({ id, chatId: this.chatId, userId: this.userId, imageDigest: settings.imageDigest, status: 'provisioning', hardExpiresAt: new Date(now.getTime() + settings.hardTimeoutSeconds * 1000), expiresAt: new Date(now.getTime() + settings.idleTimeoutSeconds * 1000) }).onConflictDoNothing()
      await this.onLeaseEvent?.('provisioning')
      let response: Response
      try {
        response = await this.request('/v1/leases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId: this.chatId, imageDigest: settings.imageDigest, warmCapacity: settings.warmCapacity, maxActiveWorkspaces: settings.maxActiveWorkspaces, idleTimeoutSeconds: settings.idleTimeoutSeconds, hardTimeoutSeconds: settings.hardTimeoutSeconds, resources: { cpu: settings.cpu, memory: settings.memory, ephemeralStorage: settings.ephemeralStorage } }) })
      } catch (error) {
        await db.update(workspaceLeases).set({ status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(workspaceLeases.id, id))
        await this.onLeaseEvent?.('unavailable', { error: error instanceof Error ? error.message : String(error) })
        throw error
      }
      const lease = await response.json() as { id: string }
      this.localLeaseId = id; this.controllerLeaseId = lease.id
      await db.update(workspaceLeases).set({ controllerLeaseId: lease.id, status: 'ready', claimedAt: now, lastUsedAt: now, updatedAt: now }).where(eq(workspaceLeases.id, id))
      await this.onLeaseEvent?.('ready', { reused: false })
    }
    if (!this.staged) await this.stageAttachments()
    return this.controllerLeaseId
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
    let leaseId = await this.ensureLease()
    const init = { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: operationId, type, args }) }
    let response: Response
    try { response = await this.request(`/v1/leases/${leaseId}/v1/operations`, init) } catch (error) {
      if (signal?.aborted) { await this.cancel(operationId); throw error }
      if (!(error instanceof Error) || !error.message.includes('(404)')) throw error
      if (this.localLeaseId) await db.update(workspaceLeases).set({ status: 'expired', error: 'Controller lease expired', updatedAt: new Date() }).where(eq(workspaceLeases.id, this.localLeaseId))
      await this.onLeaseEvent?.('expired')
      this.localLeaseId = undefined; this.controllerLeaseId = undefined; this.staged = false
      leaseId = await this.ensureLease()
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
}

export async function releaseWorkspaceForChat(chatId: string): Promise<void> {
  const [lease] = await db.select().from(workspaceLeases).where(and(eq(workspaceLeases.chatId, chatId), inArray(workspaceLeases.status, ['provisioning', 'ready']))).limit(1)
  if (!lease) return
  const config = getConfig()
  if (lease.controllerLeaseId && config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN) {
    await fetch(`${config.WORKSPACE_CONTROLLER_URL.replace(/\/$/, '')}/v1/leases/${lease.controllerLeaseId}`, { method: 'DELETE', headers: { authorization: `Bearer ${config.WORKSPACE_CONTROLLER_TOKEN}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }
  await db.update(workspaceLeases).set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() }).where(eq(workspaceLeases.id, lease.id))
}
