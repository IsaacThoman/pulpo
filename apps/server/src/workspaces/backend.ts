import { workspaceOperationIdentity } from '@pulpo/contracts'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { WORKSPACE_UNRESPONSIVE_MS, type WorkspaceSelection, type WorkspaceWait } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { responses, workspaceComputers, workspaceOperations, toolExecutions, agentRuns } from '../database/schema.js'
import { WorkspaceManager, type WorkspaceOperation } from '../agent/controller.js'
import { credentialHash } from './service.js'
import { getBlobStore } from '../storage/index.js'
import { attachments } from '../database/schema.js'
import { detectImageMime } from '../agent/images.js'

export class WorkspacePaused extends Error { constructor() { super('Waiting for workspace recovery'); this.name = 'WorkspacePaused' } }
export interface WorkspaceBackend {
  execute(id: string, type: string, args: Record<string, unknown>, signal?: AbortSignal, update?: (output: string) => void, started?: () => void | Promise<void>): Promise<WorkspaceOperation>
  viewImage(path: string, signal?: AbortSignal, started?: () => void | Promise<void>, operationId?: string): Promise<{ data: string; mimeType: string; sizeBytes: number }>
  exportFile(path: string, signal?: AbortSignal, started?: () => void | Promise<void>, operationId?: string): Promise<{ data: Uint8Array; sizeBytes: number }>
  cancel(id: string): Promise<void>
  readonly leaseId: string | undefined
  readonly continuedWithoutAgent: boolean
  disableTools(): void
}
const wait = () => new Promise(resolve => setTimeout(resolve, 250))
export class RoutedWorkspaceManager implements WorkspaceBackend {
  readonly cloud: WorkspaceManager
  paused = false
  private disabled = false
  private staged = false
  private lastAlive = Date.now()
  private capacity = false
  private onPause?: () => void
  constructor(readonly responseId: string, readonly chatId: string, readonly userId: string,
    readonly selection: WorkspaceSelection, readonly generation: number, readonly waitSeconds: number,
    onLeaseEvent?: ConstructorParameters<typeof WorkspaceManager>[3]) {
    this.cloud = new WorkspaceManager(responseId, chatId, userId, async (state, details) => {
      this.capacity = state === 'waiting' || state === 'provisioning'
      if (state === 'ready') this.lastAlive = Date.now()
      if (state === 'waiting') {
        const now = new Date()
        await db.update(responses).set({ workspaceWait: { generation: this.generation, reason: 'capacity', startedAt: now.toISOString(), deadline: new Date(now.getTime() + this.waitSeconds * 1000).toISOString(), mayHaveStarted: false, workspace: this.selection } }).where(and(eq(responses.id, this.responseId), eq(responses.workspaceGeneration, this.generation), isNull(responses.workspaceWait)))
      }
      if (state === 'ready') await db.update(responses).set({ workspaceWait: null }).where(and(eq(responses.id, this.responseId), eq(responses.workspaceGeneration, this.generation)))
      await onLeaseEvent?.(state, details)
    })
    this.cloud.onHeartbeat = () => { if (!this.capacity) this.lastAlive = Date.now() }
  }
  setPauseHandler(handler: () => void) { this.onPause = handler }
  get leaseId() { return this.cloud.leaseId }
  get continuedWithoutAgent() { return this.disabled || this.selection.kind === 'none' || this.cloud.continuedWithoutAgent }
  disableTools() { this.disabled = true; this.cloud.disableTools() }
  async environment(): Promise<string> {
    if (this.selection.kind !== 'computer') return ''
    const [computer] = await db.select().from(workspaceComputers).where(eq(workspaceComputers.id, this.selection.deviceId)).limit(1)
    const root = computer?.registration.roots.find(root => this.selection.kind === 'computer' && root.id === this.selection.rootId)
    return `This workspace is the user's ${computer?.registration.platform} computer, ${JSON.stringify(computer?.registration.name)}. Shell: ${JSON.stringify(computer?.registration.shell)}. Supported operations: ${JSON.stringify(computer?.registration.supportedTools)}. Working folder: ${JSON.stringify(root?.path)}. Commands run with the OS user's permissions. This is NOT a disposable VM. Never automatically elevate privileges. Relative paths use this folder. /workspace/ paths in file tools refer to the attachment staging directory. In shell commands use the real staging directory: ${JSON.stringify(`${computer?.registration.stagingPath}${computer?.registration.platform === 'win32' ? '\\' : '/'}${this.responseId}`)}. Use native absolute paths for project files. Tools and installed packages may differ from Pulpo's managed workspace.`
  }
  private async suspend(operationId: string, mayHaveStarted: boolean): Promise<never> {
    this.paused = true
    const startedAt = new Date()
    const workspaceWait: WorkspaceWait = { generation: this.generation, operationId, reason: this.capacity ? 'capacity' : 'unresponsive', startedAt: startedAt.toISOString(), deadline: new Date(startedAt.getTime() + this.waitSeconds * 1000).toISOString(), mayHaveStarted, workspace: this.selection }
    await db.update(responses).set({ workspaceWait, updatedAt: startedAt }).where(and(eq(responses.id, this.responseId), eq(responses.workspaceGeneration, this.generation), isNull(responses.workspaceWait)))
    this.onPause?.()
    console.info(JSON.stringify({ event: 'workspace.paused', responseId: this.responseId, generation: this.generation, reason: workspaceWait.reason }))
    throw new WorkspacePaused()
  }
  private async checkGeneration() {
    const [row] = await db.select({ generation: responses.workspaceGeneration, status: responses.status }).from(responses).where(eq(responses.id, this.responseId)).limit(1)
    if (!row || row.status === 'cancelled') throw new Error('Generation cancelled')
    if (row.generation !== this.generation) { this.paused = true; this.onPause?.(); throw new WorkspacePaused() }
  }
  async execute(id: string, type: string, args: Record<string, unknown>, signal?: AbortSignal, update?: (output: string) => void, started?: () => void | Promise<void>): Promise<WorkspaceOperation> {
    if (this.continuedWithoutAgent) throw new Error('Workspace tools disabled')
    if (this.paused) throw new WorkspacePaused()
    await this.checkGeneration()
    if (this.selection.kind === 'computer') {
      if (!this.staged && type !== 'import') await this.stage(signal)
      return this.computerOperation(id, type, args, signal, update, started)
    }
    this.lastAlive = Date.now()
    const abort = new AbortController()
    const monitor = setInterval(() => {
      void this.checkGeneration().catch(error => abort.abort(error))
      if (Date.now() - this.lastAlive >= WORKSPACE_UNRESPONSIVE_MS) abort.abort(new WorkspacePaused())
    }, 250)
    try {
      const [previous] = await db.select({ leaseId: toolExecutions.workspaceLeaseId }).from(toolExecutions).innerJoin(agentRuns, eq(agentRuns.id, toolExecutions.agentRunId)).where(and(eq(agentRuns.responseId, this.responseId), eq(toolExecutions.operationId, id))).limit(1)
      await this.cloud.ensureLease(AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]))
      if (previous?.leaseId && previous.leaseId !== this.cloud.leaseId) return this.suspend(id, true)
      // Persist the destination before dispatch, including when the acknowledgment is lost.
      await db.update(toolExecutions).set({ workspaceLeaseId: this.cloud.leaseId }).where(eq(toolExecutions.operationId, id))
      const result = await this.cloud.execute(id, type, args, AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]), update, started, !!previous?.leaseId)
      await this.checkGeneration()
      return result
    } catch (error) {
      if (this.paused) throw new WorkspacePaused()
      if (abort.signal.aborted || (error instanceof Error && /unknown|lease expired/i.test(error.message))) return this.suspend(id, !this.capacity)
      throw error
    } finally { clearInterval(monitor) }
  }
  private async stage(signal?: AbortSignal) {
    const rows = await db.select().from(attachments).where(and(eq(attachments.chatId, this.chatId), eq(attachments.userId, this.userId), eq(attachments.status, 'ready')))
    for (const row of rows) {
      const stream = await getBlobStore().getStream(row.objectKey)
      const chunks: Buffer[] = []; let size = 0
      for await (const part of stream) { const bytes = Buffer.from(part); size += bytes.length; if (size > 25 * 1024 * 1024) throw new Error('Computer workspace attachment exceeds 25 MiB'); chunks.push(bytes) }
      const { restoredAttachmentWorkspacePath } = await import('../agent/policy.js')
      await this.computerOperation(`import:${row.id}`, 'import', { path: restoredAttachmentWorkspacePath(row), data: Buffer.concat(chunks).toString('base64') }, signal)
    }
    this.staged = true
  }
  private async computerOperation(operationId: string, type: string, args: Record<string, unknown>, signal?: AbortSignal, update?: (output: string) => void, started?: () => void | Promise<void>): Promise<WorkspaceOperation> {
    if (this.selection.kind !== 'computer') throw new Error('Not a computer workspace')
    const key = and(eq(workspaceOperations.responseId, this.responseId), eq(workspaceOperations.generation, this.generation), eq(workspaceOperations.operationId, operationId))
    const hash = credentialHash(workspaceOperationIdentity(type, args))
    await db.insert(workspaceOperations).values({ id: randomUUID(), responseId: this.responseId, deviceId: this.selection.deviceId, rootId: this.selection.rootId, generation: this.generation, operationId, type, arguments: args, hash, deadline: new Date(Date.now() + Math.min(Number(args.timeoutMs ?? 600_000), 3_600_000)) }).onConflictDoNothing()
    let announced = false; let previous = ''
    while (true) {
      await this.checkGeneration()
      if (signal?.aborted) { await this.cancel(operationId); throw signal.reason }
      const [row] = await db.select().from(workspaceOperations).where(key).limit(1)
      if (!row || row.hash !== hash) throw new Error('Workspace operation identity conflict')
      if (row.retiredAt) throw new Error('Operation retired; its outcome may be unknown. Do not repeat it without an explicit user request.')
      if (row.result && !announced) { announced = true; await started?.() }
      if (row.result?.output !== undefined && previous !== row.result.output) { previous = row.result.output; update?.(previous) }
      if (row.result && row.result.status !== 'running') {
        if (row.result.status === 'unknown') return this.suspend(operationId, true)
        if (row.result.status === 'failed') throw new Error(row.result.error ?? 'Workspace operation failed')
        return { ...row.result, id: operationId, status: row.result.status }
      }
      if (Date.now() - (row.lastSeenAt ?? row.createdAt).getTime() >= WORKSPACE_UNRESPONSIVE_MS) return this.suspend(operationId, !!row.dispatchedAt)
      await wait()
    }
  }
  private async monitorRead<T>(id: string, signal: AbortSignal | undefined, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.continuedWithoutAgent) throw new Error('Workspace tools disabled')
    this.lastAlive = Date.now()
    const abort = new AbortController()
    const monitor = setInterval(() => {
      void this.checkGeneration().catch(error => abort.abort(error))
      if (Date.now() - this.lastAlive >= WORKSPACE_UNRESPONSIVE_MS) abort.abort(new WorkspacePaused())
    }, 250)
    try { return await read(AbortSignal.any([abort.signal, ...(signal ? [signal] : [])])) }
    catch (error) {
      if (this.paused) throw new WorkspacePaused()
      if (abort.signal.reason instanceof WorkspacePaused) return this.suspend(id, false)
      throw error
    } finally { clearInterval(monitor) }
  }
  async viewImage(path: string, signal?: AbortSignal, started?: () => void | Promise<void>, operationId: string = randomUUID()) {
    if (this.selection.kind !== 'computer') return this.monitorRead(operationId, signal, activeSignal => this.cloud.viewImage(path, activeSignal, started))
    const result = await this.execute(operationId, 'export', { path }, signal, undefined, started)
    const bytes = Buffer.from(result.output, 'base64'); const mimeType = detectImageMime(bytes)
    if (!mimeType || bytes.length > 20 * 1024 * 1024) throw new Error('Image is unsupported or exceeds 20 MiB')
    return { data: result.output, mimeType, sizeBytes: bytes.length }
  }
  async exportFile(path: string, signal?: AbortSignal, started?: () => void | Promise<void>, operationId: string = randomUUID()) {
    if (this.selection.kind !== 'computer') return this.monitorRead(operationId, signal, activeSignal => this.cloud.exportFile(path, activeSignal, started))
    const result = await this.execute(operationId, 'export', { path }, signal, undefined, started)
    const data = Buffer.from(result.output, 'base64')
    if (data.length > 25 * 1024 * 1024) throw new Error('File exceeds 25 MiB')
    return { data, sizeBytes: data.length }
  }
  async cancel(operationId: string) {
    if (this.selection.kind !== 'computer') return this.cloud.cancel(operationId)
    await db.update(workspaceOperations).set({ cancelRequested: true }).where(and(eq(workspaceOperations.responseId, this.responseId), eq(workspaceOperations.generation, this.generation), eq(workspaceOperations.operationId, operationId)))
  }
}
