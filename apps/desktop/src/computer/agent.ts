import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import {
  COMPUTER_HEARTBEAT_INTERVAL_MS, toolApprovalRequired,
  type ComputerClientToServerEvents, type ComputerOperationSnapshot, type ComputerPairing, type ComputerReply, type ComputerRequest,
  type ComputerServerToClientEvents, type DesktopComputerState, type DesktopComputerUpdate, type ToolApproval,
} from '@pulpo/contracts'
import type { Operation } from '@pulpo/workspace-daemon/core'
import { loadComputerConfig, normalizeComputerConfig, saveComputerConfig, type ComputerConfig } from './config-store'
import { computerOsFor, createComputerRuntime, type ComputerRuntime } from './runtime'

export type ComputerSocket = Socket<ComputerServerToClientEvents, ComputerClientToServerEvents>

export interface ComputerPromptHandle {
  decision: Promise<boolean>
  /** Close the prompt because the question was answered somewhere else. */
  dismiss(): void
}

export interface ComputerPrompts {
  pairing(pairing: ComputerPairing): ComputerPromptHandle
}

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
  prompts: ComputerPrompts
  onStateChange?: (state: DesktopComputerState) => void
  connect?: (url: string, options: Partial<ManagerOptions & SocketOptions>) => ComputerSocket
  log?: ComputerAgentLogger
  /** How long an approval-gated operation waits for the decision event to arrive before refusing. */
  approvalGraceMs?: number
}

interface FileTransfer {
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
  private readonly approvedIds = new Set<string>()
  private readonly approvalWaiters = new Map<string, Array<(approved: boolean) => void>>()
  private readonly pendingApprovals = new Set<string>()
  private readonly openPairings = new Map<string, ComputerPromptHandle>()
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
      pendingPairings: this.openPairings.size,
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
    await this.disconnect()
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
      void this.runtime.runner.cancelAll()
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
      auth: { sessionToken: token, computer: runtime.announce },
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
        this.setStatus('error', 'This computer was removed from your account. Turn it off and on again to register it fresh.')
        socket.disconnect()
      } else if (message === 'computer_owner_mismatch') {
        this.setStatus('error', 'This computer is registered to a different Pulpo account.')
        socket.disconnect()
      } else {
        this.setStatus('offline', `Cannot reach Pulpo: ${message}`)
      }
    })
    socket.on('computer.request', (request, ack) => {
      void this.handleRequest(request).then(ack, (error) => ack(failure(error instanceof Error ? error.message : String(error))))
    })
    socket.on('computer.approval.requested', (approval) => this.trackApproval(approval))
    socket.on('computer.approval.decided', ({ approvalId, status }) => this.resolveApproval(approvalId, status === 'approved'))
    socket.on('computer.pairing.requested', (pairing) => this.promptPairing(pairing))
    socket.on('computer.pairing.decided', ({ pairingId }) => {
      this.openPairings.get(pairingId)?.dismiss()
      this.openPairings.delete(pairingId)
      this.publish()
    })
    socket.on('computer.revoked', ({ reason }) => {
      void (async () => {
        await this.runtime?.runner.cancelAll()
        this.pendingApprovals.clear()
        if (reason === 'disabled' || reason === 'deleted') {
          this.config = { ...this.config, enabled: false }
          await saveComputerConfig(this.options.userDataDir, this.config)
        }
        await this.disconnect()
        this.setStatus(reason === 'session_revoked' ? 'offline' : 'disabled', reason === 'session_revoked' ? 'Sign in again to share this computer.' : null)
      })().catch((error) => this.log.error('revocation handling failed', error))
    })
    socket.on('computer.superseded', () => {
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
    const next = normalizeComputerConfig({ ...previous, ...patch, version: 1, computerId: previous.computerId }, this.options.hostname)
    if (patch.enabled && next.accessMode === 'folder' && !next.rootPath) throw new Error('Choose a folder before enabling this computer.')
    if (patch.enabled) next.enabled = true
    this.config = next
    await saveComputerConfig(this.options.userDataDir, next)
    if (previous.enabled && !next.enabled) {
      await this.runtime?.runner.cancelAll()
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
    await this.runtime?.runner.cancelAll()
    await this.disconnect()
    for (const handle of this.openPairings.values()) handle.dismiss()
    this.pendingApprovals.clear()
    this.openPairings.clear()
  }

  private trackApproval(approval: ToolApproval): void {
    if (this.pendingApprovals.has(approval.id)) return
    this.pendingApprovals.add(approval.id)
    this.publish()
  }

  private resolveApproval(approvalId: string, approved: boolean): void {
    if (approved) this.approvedIds.add(approvalId)
    if (this.pendingApprovals.delete(approvalId)) this.publish()
    for (const resolve of this.approvalWaiters.get(approvalId) ?? []) resolve(approved)
    this.approvalWaiters.delete(approvalId)
  }

  private promptPairing(pairing: ComputerPairing): void {
    if (this.openPairings.has(pairing.id)) return
    const handle = this.options.prompts.pairing(pairing)
    this.openPairings.set(pairing.id, handle)
    this.publish()
    void handle.decision.then((approved) => {
      if (this.openPairings.get(pairing.id) !== handle) return
      this.openPairings.delete(pairing.id)
      this.publish()
      this.socket?.emit('computer.pairing.decide', { pairingId: pairing.id, approved }, (result) => {
        if (!result.ok) this.log.warn('pairing decision rejected', result.error)
      })
    }).catch((error) => this.log.error('pairing prompt failed', error))
  }

  /** Wait briefly for a decision that may still be in flight from the chat UI. */
  private awaitApproval(approvalId: string): Promise<boolean> {
    if (this.approvedIds.has(approvalId)) return Promise.resolve(true)
    const graceMs = this.options.approvalGraceMs ?? 2_000
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const waiters = this.approvalWaiters.get(approvalId)?.filter((entry) => entry !== settle) ?? []
        if (waiters.length) this.approvalWaiters.set(approvalId, waiters)
        else this.approvalWaiters.delete(approvalId)
        resolve(false)
      }, graceMs)
      const settle = (approved: boolean) => { clearTimeout(timer); resolve(approved) }
      this.approvalWaiters.set(approvalId, [...(this.approvalWaiters.get(approvalId) ?? []), settle])
    })
  }

  async handleRequest(request: ComputerRequest): Promise<ComputerReply> {
    const runtime = this.runtime
    if (!runtime || !this.config.enabled) return failure('This computer is not sharing with the agent', 'disabled')
    switch (request.kind) {
      case 'operation.start': {
        if (toolApprovalRequired(request.type, this.config.approvalPolicy)) {
          if (!request.approvalId || !await this.awaitApproval(request.approvalId)) return failure('This action needs the user\'s approval before it can run', 'approval_required')
        }
        const operation = await runtime.runner.execute(request.id, request.type, request.args ?? {})
        return { ok: true, result: snapshot(operation) }
      }
      case 'operation.status': {
        const operation = await runtime.runner.find(request.id)
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
          const target = runtime.attachmentsPolicy.writable(file.path)
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

  private async beginTransfer(runtime: ComputerRuntime, request: Extract<ComputerRequest, { kind: 'file.begin' }>): Promise<ComputerReply> {
    if (!Number.isSafeInteger(request.sizeBytes) || request.sizeBytes < 0 || request.sizeBytes > MAX_TRANSFER_BYTES) return failure('File size is missing or exceeds the limit', 'invalid_request')
    const target = await runtime.attachmentsPolicy.writableChecked(request.path)
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${request.transferId}.upload`
    const handle = await open(temporary, 'wx')
    this.transfers.set(request.transferId, { target, temporary, handle, sizeBytes: request.sizeBytes, checksum: request.checksum, received: 0, hash: createHash('sha256') })
    return { ok: true, result: { transferId: request.transferId } }
  }

  private async appendTransfer(request: Extract<ComputerRequest, { kind: 'file.chunk' }>): Promise<ComputerReply> {
    const transfer = this.transfers.get(request.transferId)
    if (!transfer) return failure('Unknown transfer', 'invalid_request')
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

  private async finishTransfer(runtime: ComputerRuntime, request: Extract<ComputerRequest, { kind: 'file.end' }>): Promise<ComputerReply> {
    const transfer = this.transfers.get(request.transferId)
    if (!transfer) return failure('Unknown transfer', 'invalid_request')
    this.transfers.delete(request.transferId)
    await transfer.handle.close()
    try {
      if (transfer.received !== transfer.sizeBytes) throw new Error('Uploaded file size does not match')
      const digest = transfer.hash.digest('base64url')
      if (transfer.checksum && transfer.checksum !== digest) throw new Error('Uploaded file checksum does not match')
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

  private async readFile(runtime: ComputerRuntime, request: Extract<ComputerRequest, { kind: 'file.read' }>): Promise<ComputerReply> {
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
