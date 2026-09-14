import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import {
  computerActionPayload, COMPUTER_HEARTBEAT_INTERVAL_MS, toolApprovalRequired,
  type ComputerClientToServerEvents, type ComputerOperationSnapshot, type ComputerReply, type ComputerRequest,
  type ComputerServerToClientEvents, type DesktopComputerState, type DesktopComputerUpdate, type ToolApproval,
} from '@pulpo/contracts'
import type { Operation } from '@pulpo/workspace-daemon/core'
import { loadComputerConfig, normalizeComputerConfig, saveComputerConfig, type ComputerConfig } from './config-store'
import { computerOsFor, createComputerRuntime, type ComputerRuntime, type ChatComputerRuntime } from './runtime'

export type ComputerSocket = Socket<ComputerServerToClientEvents, ComputerClientToServerEvents>

export interface ComputerAgentLogger {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
}

export interface ComputerAgentOptions {
  userDataDir: string
  homeDir: string
  hostname: string
  platform: NodeJS.Platform
  arch: string
  appVersion: string
  rgPath?: string
  env?: NodeJS.ProcessEnv
  loadSession: () => Promise<{ instanceUrl: string; token: string } | null>
  onStateChange?: (state: DesktopComputerState) => void
  connect?: (url: string, options: Partial<ManagerOptions & SocketOptions>) => ComputerSocket
  log?: ComputerAgentLogger
  /** How long an approval-gated operation waits for the decision event to arrive before refusing. */
  approvalGraceMs?: number
}

interface FileTransfer {
  chatId: string
  sessionId?: string
  responseId?: string
  target: string
  temporary: string
  handle: FileHandle
  sizeBytes: number
  checksum: string | null
  received: number
  hash: ReturnType<typeof createHash>
}

const MAX_TRANSFER_BYTES = 1_000 * 1024 * 1024

function snapshot(operation: Operation): ComputerOperationSnapshot {
  return { id: operation.id, status: operation.status, output: operation.output, exitCode: operation.exitCode, ...(operation.error ? { error: operation.error } : {}), ...(operation.details ? { details: operation.details } : {}) }
}

const failure = (error: string, code: Extract<ComputerReply, { ok: false }>['code'] = 'failed'): ComputerReply => ({ ok: false, error, code })

/**
 * Runs in the Electron main process. Owns the `/computer` socket, executes relayed operations
 * through the daemon core, and gates approval-protected operations on a decision the user made
 * in the chat UI.
 */
export class ComputerAgent {
  private config!: ComputerConfig
  private runtime?: ComputerRuntime
  private socket?: ComputerSocket
  private socketKey?: string
  private heartbeat?: NodeJS.Timeout
  private status: DesktopComputerState['status'] = 'disabled'
  private error: string | null = null
  private needsRegistration = false
  private ownerSessionId?: string
  private readonly revokedResponses = new Set<string>()
  private readonly revokedSessions = new Set<string>()
  private readonly activeOperations = new Map<string, { chatId: string; sessionId?: string; responseId?: string }>()
  private readonly pendingApprovals = new Set<string>()
  private readonly transfers = new Map<string, FileTransfer>()
  private readonly log: ComputerAgentLogger
  private started = false

  constructor(private readonly options: ComputerAgentOptions) {
    this.log = options.log ?? console
  }

  get state(): DesktopComputerState {
    return {
      status: this.status,
      error: this.error,
      computerId: this.config.computerId,
      name: this.config.name,
      enabled: this.config.enabled,
      accessMode: this.config.accessMode,
      rootPath: this.config.rootPath,
      approvalPolicy: this.config.approvalPolicy,
      allowRemote: this.config.allowRemote,
      os: computerOsFor(this.options.platform),
      hostname: this.options.hostname,
      homeDir: this.options.homeDir,
      pendingApprovals: this.pendingApprovals.size,
      pendingPairings: 0,
    }
  }

  private setStatus(status: DesktopComputerState['status'], error: string | null = null): void {
    this.status = status
    this.error = error
    this.publish()
  }

  private publish(): void {
    this.options.onStateChange?.(this.state)
  }

  async start(): Promise<DesktopComputerState> {
    this.config = await loadComputerConfig(this.options.userDataDir, this.options.hostname)
    await saveComputerConfig(this.options.userDataDir, this.config)
    this.started = true
    await this.refresh()
    return this.state
  }

  /** Reconcile the connection with the current config and session. */
  async refresh(): Promise<void> {
    if (!this.started) return
    if (!this.config.enabled) {
      await this.disconnect()
      this.setStatus('disabled')
      return
    }
    const session = await this.options.loadSession()
    if (!session) {
      await this.runtime?.cancelAll()
      await this.abortTransfers()
      this.pendingApprovals.clear()
      await this.disconnect()
      this.setStatus('offline', 'Sign in to the desktop app to share this computer with the agent.')
      return
    }
    try {
      this.ensureRuntime()
    } catch (error) {
      await this.disconnect()
      this.setStatus('error', error instanceof Error ? error.message : String(error))
      return
    }
    const key = `${session.instanceUrl}|${session.token}`
    if (this.socket && this.socketKey === key) {
      this.socket.emit('computer.update', this.runtime!.announce, (result) => {
        if (!result.ok) this.log.warn('computer.update rejected', result.error)
      })
      return
    }
    await this.runtime?.cancelAll()
    await this.abortTransfers()
    await this.disconnect()
    this.revokedSessions.clear()
    this.revokedResponses.clear()
    this.socketKey = key
    this.openSocket(session.instanceUrl, session.token)
  }

  private ensureRuntime(): ComputerRuntime {
    const runtime = createComputerRuntime({
      config: this.config, userDataDir: this.options.userDataDir, homeDir: this.options.homeDir, platform: this.options.platform,
      arch: this.options.arch, appVersion: this.options.appVersion, rgPath: this.options.rgPath, env: this.options.env,
    })
    if (this.runtime) {
      const previous = this.runtime.announce
      const next = runtime.announce
      const unchanged = previous.rootPath === next.rootPath && previous.accessMode === next.accessMode
      if (unchanged) {
        // Keep the running operations; only the announce metadata changed.
        this.runtime = { ...this.runtime, announce: next }
        return this.runtime
      }
      void this.runtime.cancelAll()
    }
    this.runtime = runtime
    return runtime
  }

  private openSocket(instanceUrl: string, token: string): void {
    const runtime = this.runtime!
    const connect = this.options.connect ?? ((url, socketOptions) => io(url, socketOptions) as ComputerSocket)
    this.setStatus('connecting')
    const socket = connect(`${instanceUrl.replace(/\/$/, '')}/computer`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { sessionToken: token, computer: runtime.announce, deviceSecret: this.config.deviceSecret },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
    })
    this.socket = socket
    socket.on('connect', () => {
      this.setStatus('online')
      this.startHeartbeat()
    })
    socket.on('disconnect', (reason) => {
      void this.runtime?.cancelAll()
      void this.abortTransfers()
      this.stopHeartbeat()
      if (this.socket !== socket) return
      if (this.status !== 'error') this.setStatus(reason === 'io client disconnect' ? 'disabled' : 'offline', reason === 'io client disconnect' ? null : 'Reconnecting to Pulpo…')
    })
    socket.on('connect_error', (error) => {
      if (this.socket !== socket) return
      const message = error.message
      if (message === 'unauthorized') {
        this.setStatus('error', 'This desktop session is no longer valid. Sign in again to share this computer.')
        socket.disconnect()
      } else if (message === 'computers_disabled') {
        this.setStatus('error', 'This Pulpo instance does not allow the agent to use personal computers.')
        socket.disconnect()
      } else if (message === 'computer_revoked') {
        this.needsRegistration = true
        this.setStatus('error', 'This computer was removed from your account. Turn it off and on again to register it fresh.')
        socket.disconnect()
      } else if (message === 'computer_credential_invalid' || message === 'computer_credential_required') {
        this.needsRegistration = true
        this.setStatus('error', 'This computer needs to be registered again. Turn access off and on to register this installation.')
        socket.disconnect()
      } else if (message === 'computer_owner_mismatch') {
        this.setStatus('error', 'This computer is registered to a different Pulpo account.')
        socket.disconnect()
      } else {
        this.setStatus('offline', `Cannot reach Pulpo: ${message}`)
      }
    })
    socket.on('computer.ready', ({ sessionId }) => { this.ownerSessionId = sessionId })
    socket.on('computer.response.revoked', ({ responseId }) => { void this.cancelResponse(responseId) })
    socket.on('computer.access.revoked', ({ sessionId }) => { void this.cancelSession(sessionId) })
    socket.on('computer.access.granted', ({ sessionId }) => { this.revokedSessions.delete(sessionId) })
    socket.on('computer.request', (request, ack) => {
      void this.handleRequest(request).then(ack, (error) => ack(failure(error instanceof Error ? error.message : String(error))))
    })
    socket.on('computer.approval.requested', (approval) => this.trackApproval(approval))
    socket.on('computer.approval.decided', ({ approvalId }) => this.resolveApproval(approvalId))

    socket.on('computer.revoked', ({ reason }) => {
      void (async () => {
        await this.runtime?.cancelAll()
        this.pendingApprovals.clear()
        await this.abortTransfers()
        if (reason === 'disabled' || reason === 'deleted') {
          this.config = { ...this.config, enabled: false, ...(reason === 'deleted' ? { computerId: randomUUID(), deviceSecret: randomBytes(32).toString('hex') } : {}) }
          await saveComputerConfig(this.options.userDataDir, this.config)
        }
        await this.disconnect()
        this.setStatus(reason === 'session_revoked' ? 'offline' : 'disabled', reason === 'session_revoked' ? 'Sign in again to share this computer.' : null)
      })().catch((error) => this.log.error('revocation handling failed', error))
    })
    socket.on('computer.superseded', () => {
      void this.runtime?.cancelAll()
      void this.abortTransfers()
      if (this.socket !== socket) return
      this.socket = undefined
      socket.disconnect()
      this.setStatus('error', 'Another Pulpo window on this computer took over the agent connection.')
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => this.socket?.emit('computer.heartbeat'), COMPUTER_HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
  }

  private async disconnect(): Promise<void> {
    this.stopHeartbeat()
    const socket = this.socket
    this.socket = undefined
    this.socketKey = undefined
    socket?.removeAllListeners()
    socket?.disconnect()
  }

  async updateConfig(patch: DesktopComputerUpdate): Promise<DesktopComputerState> {
    const previous = this.config
    if (patch.enabled && this.needsRegistration) {
      this.config = { ...previous, computerId: randomUUID(), deviceSecret: randomBytes(32).toString('hex') }
      this.needsRegistration = false
    }
    const next = normalizeComputerConfig({ ...this.config, ...patch, version: 1, computerId: this.config.computerId }, this.options.hostname)
    if (patch.enabled && next.accessMode === 'folder' && !next.rootPath) throw new Error('Choose a folder before enabling this computer.')
    if (patch.enabled) next.enabled = true
    this.config = next
    if (previous.allowRemote && !next.allowRemote) {
      for (const sessionId of new Set([...this.activeOperations.values()].map((entry) => entry.sessionId))) {
        if (sessionId && sessionId !== this.ownerSessionId) await this.cancelSession(sessionId)
      }
    }
    await saveComputerConfig(this.options.userDataDir, next)
    if (previous.enabled && !next.enabled) {
      await this.runtime?.cancelAll()
      await this.abortTransfers()
      this.pendingApprovals.clear()
    }
    await this.refresh()
    return this.state
  }

  /** The stored session changed (sign-in, instance switch, sign-out). */
  async sessionChanged(): Promise<void> {
    await this.refresh()
  }

  async stop(): Promise<void> {
    await this.runtime?.cancelAll()
    await this.abortTransfers()
    await this.disconnect()
    this.pendingApprovals.clear()
  }

  private trackApproval(approval: ToolApproval): void {
    if (this.pendingApprovals.has(approval.id)) return
    this.pendingApprovals.add(approval.id)
    this.publish()
  }

  private resolveApproval(approvalId: string): void {
    if (this.pendingApprovals.delete(approvalId)) this.publish()
  }

  async createPairingCode(): Promise<{ code: string; expiresAt: string }> {
    if (!this.socket || this.status !== 'online' || !this.config.allowRemote) throw new Error('Enable remote access and connect this computer first.')
    const result = await this.socket.timeout(5_000).emitWithAck('computer.pairing.code')
    if (!result.code || !result.expiresAt) throw new Error(result.error ?? 'Could not generate a pairing code.')
    return { code: result.code, expiresAt: result.expiresAt }
  }

  private async cancelSession(sessionId: string): Promise<void> {
    this.revokedSessions.add(sessionId)
    for (const [id, operation] of this.activeOperations) {
      if (operation.sessionId === sessionId) await this.runtime?.forChat(operation.chatId).runner.cancel(id)
    }
    await this.abortTransfers(sessionId)
  }

  private async cancelResponse(responseId: string): Promise<void> {
    this.revokedResponses.add(responseId)
    for (const [id, operation] of this.activeOperations) {
      if (operation.responseId === responseId) await this.runtime?.forChat(operation.chatId).runner.cancel(id)
    }
    await this.abortTransfers(undefined, responseId)
  }

  private async abortTransfers(sessionId?: string, responseId?: string): Promise<void> {
    for (const [id, transfer] of this.transfers) {
      if (sessionId && transfer.sessionId !== sessionId) continue
      if (responseId && transfer.responseId !== responseId) continue
      this.transfers.delete(id)
      await transfer.handle.close().catch(() => undefined)
      await rm(transfer.temporary, { force: true }).catch(() => undefined)
    }
  }

  private requestAllowed(request: ComputerRequest): boolean {
    return Boolean(request.responseId && !this.revokedResponses.has(request.responseId) && request.requesterSessionId && !this.revokedSessions.has(request.requesterSessionId) && (this.config.allowRemote || request.requesterSessionId === this.ownerSessionId))
  }

  /** Query durable server approval state with the exact action; a missed event or restart is harmless. */
  private async awaitApproval(request: Extract<ComputerRequest, { kind: 'operation.start' }>): Promise<boolean> {
    const socket = this.socket
    if (!socket || !request.approvalId) return false
    const digest = createHash('sha256').update(computerActionPayload(request.chatId, request.id, request.type, request.args, { computerId: this.config.computerId, root: this.runtime!.announce.rootPath, accessMode: this.config.accessMode })).digest('hex')
    const deadline = Date.now() + (this.options.approvalGraceMs ?? 2_000)
    do {
      const approved = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2_000)
        socket.emit('computer.approval.verify', { approvalId: request.approvalId!, chatId: request.chatId, operationId: request.id, digest }, (value) => { clearTimeout(timer); resolve(value === true) })
      })
      if (approved) return this.socket === socket
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 25))
    } while (this.socket === socket)
    return false
  }

  async handleRequest(request: ComputerRequest): Promise<ComputerReply> {
    const manager = this.runtime
    if (!this.requestAllowed(request)) return failure('This device no longer has access to the computer', 'disabled')
    if (!manager || !this.config.enabled) return failure('This computer is not sharing with the agent', 'disabled')
    let runtime: ChatComputerRuntime
    try { runtime = manager.forChat(request.chatId) } catch { return failure('A valid chat ID is required', 'invalid_request') }
    switch (request.kind) {
      case 'operation.start': {
        this.activeOperations.set(request.id, { chatId: request.chatId, sessionId: request.requesterSessionId, responseId: request.responseId })
        if (toolApprovalRequired(request.type, this.config.approvalPolicy)) {
          if (!request.approvalId || !await this.awaitApproval(request)) return failure('This action needs the user\'s approval before it can run', 'approval_required')
        }
        if (!this.config.enabled || this.runtime !== manager || !this.requestAllowed(request)) return failure('Computer access was revoked', 'disabled')
        const operation = await runtime.runner.execute(request.id, request.type, request.args ?? {})
        return { ok: true, result: snapshot(operation) }
      }
      case 'operation.status': {
        const operation = await runtime.runner.find(request.id)
        if (operation?.status !== 'running') this.activeOperations.delete(request.id)
        return { ok: true, result: operation ? snapshot(operation) : null }
      }
      case 'operation.cancel': {
        const operation = await runtime.runner.cancel(request.id)
        return { ok: true, result: operation ? snapshot(operation) : null }
      }
      case 'files.missing': {
        if (!Array.isArray(request.files) || request.files.length > 500) return failure('Invalid staging inventory', 'invalid_request')
        const missing: string[] = []
        for (const file of request.files) {
          if (typeof file.path !== 'string' || !Number.isSafeInteger(file.sizeBytes)) return failure('Invalid staging file', 'invalid_request')
          const target = await runtime.attachmentsPolicy.writableChecked(file.path)
          if (!await runtime.stagedFiles.matches(target, file.checksum, file.sizeBytes)) missing.push(file.path)
        }
        return { ok: true, result: { missing } }
      }
      case 'file.begin': return this.beginTransfer(runtime, request)
      case 'file.chunk': return this.appendTransfer(request)
      case 'file.end': return this.finishTransfer(runtime, request)
      case 'file.read': return this.readFile(runtime, request)
      default: return failure('Unknown request', 'invalid_request')
    }
  }

  private async beginTransfer(runtime: ChatComputerRuntime, request: Extract<ComputerRequest, { kind: 'file.begin' }>): Promise<ComputerReply> {
    if (!Number.isSafeInteger(request.sizeBytes) || request.sizeBytes < 0 || request.sizeBytes > MAX_TRANSFER_BYTES) return failure('File size is missing or exceeds the limit', 'invalid_request')
    const target = await runtime.attachmentsPolicy.writableChecked(request.path)
    await mkdir(path.dirname(target), { recursive: true })
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(request.transferId) || this.transfers.has(request.transferId)) return failure('Invalid or duplicate transfer ID', 'invalid_request')
    const temporary = `${target}.${request.transferId}.upload`
    const handle = await open(temporary, 'wx')
    this.transfers.set(request.transferId, { chatId: request.chatId, sessionId: request.requesterSessionId, responseId: request.responseId, target, temporary, handle, sizeBytes: request.sizeBytes, checksum: request.checksum, received: 0, hash: createHash('sha256') })
    return { ok: true, result: { transferId: request.transferId } }
  }

  private async appendTransfer(request: Extract<ComputerRequest, { kind: 'file.chunk' }>): Promise<ComputerReply> {
    const transfer = this.transfers.get(request.transferId)
    if (!transfer || transfer.chatId !== request.chatId) return failure('Unknown transfer', 'invalid_request')
    const chunk = Buffer.from(request.data, 'base64')
    if (transfer.received + chunk.byteLength > transfer.sizeBytes) {
      await this.abortTransfer(request.transferId)
      return failure('Uploaded file size does not match', 'invalid_request')
    }
    await transfer.handle.write(chunk)
    transfer.hash.update(chunk)
    transfer.received += chunk.byteLength
    return { ok: true, result: { received: transfer.received } }
  }

  private async finishTransfer(runtime: ChatComputerRuntime, request: Extract<ComputerRequest, { kind: 'file.end' }>): Promise<ComputerReply> {
    const transfer = this.transfers.get(request.transferId)
    if (!transfer || transfer.chatId !== request.chatId) return failure('Unknown transfer', 'invalid_request')
    this.transfers.delete(request.transferId)
    await transfer.handle.close()
    try {
      if (transfer.received !== transfer.sizeBytes) throw new Error('Uploaded file size does not match')
      const digest = transfer.hash.digest('base64url')
      if (transfer.checksum && transfer.checksum !== digest) throw new Error('Uploaded file checksum does not match')
      await runtime.attachmentsPolicy.writableChecked(transfer.target)
      await rename(transfer.temporary, transfer.target)
      await runtime.stagedFiles.record(transfer.target, digest)
      return { ok: true, result: { path: transfer.target } }
    } catch (error) {
      await rm(transfer.temporary, { force: true }).catch(() => undefined)
      return failure(error instanceof Error ? error.message : String(error), 'invalid_request')
    }
  }

  private async abortTransfer(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId)
    if (!transfer) return
    this.transfers.delete(transferId)
    await transfer.handle.close().catch(() => undefined)
    await rm(transfer.temporary, { force: true }).catch(() => undefined)
  }

  private async readFile(runtime: ChatComputerRuntime, request: Extract<ComputerRequest, { kind: 'file.read' }>): Promise<ComputerReply> {
    let resolved: string
    if (request.scope === 'export') {
      // Deliverables may come from the working folder or from the attachments the app staged.
      resolved = await runtime.policy.exportable(request.path).catch(() => runtime.attachmentsPolicy.exportable(request.path))
    } else {
      resolved = await runtime.policy.readable(request.path)
    }
    const metadata = await stat(resolved)
    if (!metadata.isFile()) return failure('Path must be a regular file', 'invalid_request')
    if (metadata.size > request.maxBytes) return failure(`File exceeds the ${request.maxBytes} byte limit`, 'invalid_request')
    const length = Math.max(0, Math.min(request.length, metadata.size - request.offset))
    const handle = await open(resolved, 'r')
    try {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = length ? await handle.read(buffer, 0, length, request.offset) : { bytesRead: 0 }
      return { ok: true, result: { data: buffer.subarray(0, bytesRead).toString('base64'), sizeBytes: metadata.size, eof: request.offset + bytesRead >= metadata.size } }
    } finally {
      await handle.close()
    }
  }
}
