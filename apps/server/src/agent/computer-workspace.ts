import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type { Readable } from 'node:stream'
import {
  COMPUTER_APP_ACT_TIMEOUT_MS, COMPUTER_APP_APPROVAL_TIMEOUT_MS, COMPUTER_INLINE_MAX_BYTES, COMPUTER_OPERATION_TYPES, COMPUTER_REQUEST_TIMEOUT_MS,
  COMPUTER_TRANSFER_TIMEOUT_MS, computerTransferTimeoutMs,
  type ComputerApp, type ComputerAppActionInput, type ComputerAppState, type ComputerDescription, type ComputerMethod, type ComputerOperationType,
  type ComputerParams, type ComputerResult,
} from '@pulpo/contracts'
import {
  computerCall, ComputerRequestError, ComputerUnavailableError, createComputerDownload, createComputerUpload,
  type ComputerCallOptions, type ComputerSessionRef,
} from '../computer/tunnel.js'
import { getBlobStore } from '../storage/index.js'
import { loadWorkspaceAttachments } from './attachment-manifest.js'
import { detectImageMime } from './images.js'
import { truncateUtf8 } from './output.js'
import { attachmentFileName } from './policy.js'
import {
  MAX_EXPORT_FILE_BYTES, MAX_VIEW_IMAGE_BYTES,
  type AgentWorkspace, type RelayRequest, type RelayResult, type WorkspaceFile, type WorkspaceImage, type WorkspaceLeaseEvent, type WorkspaceOperation, type WorkspacePaths,
} from './workspace.js'

const LONG_POLL_WAIT_MS = 10_000
/** A long-poll's answer may take its whole wait plus an ordinary request's allowance. */
const LONG_POLL_TIMEOUT_MS = LONG_POLL_WAIT_MS + COMPUTER_REQUEST_TIMEOUT_MS
const POLL_ATTEMPTS = 3
const POLL_RETRY_MS = 500
/** Keeps an app that answers long-polls at once from spinning the loop. */
const POLL_FLOOR_MS = 250
const CANCEL_TIMEOUT_MS = 10_000
/** Delivering one relay answer; it goes out even after the reply was stopped, so it is bounded on its own. */
const RELAY_DELIVERY_TIMEOUT_MS = 10_000
/**
 * Between polls while the app lists only requests already answered (a delivery to retry, or one it
 * failed to drop): it returns long-polls at once while any is listed, which would spin the loop.
 */
const STALE_RELAY_POLL_MS = 1_000
/**
 * The most output one relay answer carries. It travels in one socket message, while the Files
 * relay's own cap is the instance's `maxToolOutputBytes`, which an admin can set far higher.
 */
export const COMPUTER_RELAY_OUTPUT_MAX_BYTES = 1_048_576
const RELAY_TRUNCATED_NOTE = '\n[Output truncated; pull the file or narrow the command to see the rest.]'
/** `file.missing` takes at most this many files per request. */
const STAGE_BATCH = 500
/**
 * How long one `app.act` may take: the user may first be asked to allow the app, then the action is
 * carried out and the window looked at again, and the answer travels back.
 */
const APP_ACT_TIMEOUT_MS = COMPUTER_APP_APPROVAL_TIMEOUT_MS + COMPUTER_APP_ACT_TIMEOUT_MS + COMPUTER_REQUEST_TIMEOUT_MS

/** An app's window after `useApp`: what the computer said about it, and its picture's bytes. */
export interface ComputerAppView {
  state: Omit<ComputerAppState, 'image'>
  image: WorkspaceImage & { width: number; height: number }
}

/** For the agent and the user alike: the reply cannot go on using the computer. */
export const COMPUTER_UNAVAILABLE_MESSAGE = 'The user\'s computer is not connected to Pulpo right now, so nothing can run on it for the rest of this reply. The Pulpo desktop app must be open and signed in on that computer.'

/** The same, as the user reads it when the reply could not start. */
export const COMPUTER_UNAVAILABLE_USER_MESSAGE = 'Your computer isn\'t connected to Pulpo. Keep the Pulpo desktop app open and signed in on it, then try again.'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const byteLimit = (bytes: number) => bytes % 1_048_576 === 0 ? `${bytes / 1_048_576} MiB` : `${bytes} byte`
const isOperationType = (type: string): type is ComputerOperationType => (COMPUTER_OPERATION_TYPES as readonly string[]).includes(type)

/** Attachment checksums are base64url SHA-256; the computer wants hex. Anything else is not a checksum it can use. */
function hexChecksum(checksum: string | null | undefined): string | undefined {
  if (!checksum) return undefined
  const digest = Buffer.from(checksum, 'base64url')
  return digest.byteLength === 32 ? digest.toString('hex') : undefined
}

/** A relay answer as it may travel to the computer: its text cut to `COMPUTER_RELAY_OUTPUT_MAX_BYTES`, with a note. */
export function boundRelayResult(result: RelayResult): RelayResult {
  const bound = (text: string) => Buffer.byteLength(text, 'utf8') <= COMPUTER_RELAY_OUTPUT_MAX_BYTES
    ? text
    : `${truncateUtf8(text, COMPUTER_RELAY_OUTPUT_MAX_BYTES - Buffer.byteLength(RELAY_TRUNCATED_NOTE, 'utf8'))}${RELAY_TRUNCATED_NOTE}`
  return result.ok ? { ...result, output: bound(result.output) } : { ok: false, error: bound(result.error) }
}

export function describeComputer(session: ComputerSessionRef): Promise<ComputerDescription> {
  return computerCall(session, 'describe', {})
}

const pathFlavour = (computer: Pick<ComputerDescription, 'os'>) => computer.os === 'windows' ? win32 : posix

/** Where the server puts and looks for files on this computer, with its own separators. */
export function computerWorkspacePaths(computer: ComputerDescription): WorkspacePaths {
  const path = pathFlavour(computer)
  const attachment = (name: string, id: string) => path.join(computer.attachmentsDir, attachmentFileName(name, id))
  return {
    attachment,
    // A deliverable is never restored where it was attached from: that is the user's own file now.
    restoredAttachment: (file) => attachment(file.originalName, file.id),
    file: (name) => path.join(computer.attachmentsDir, name),
    readable: (value) => path.isAbsolute(value),
  }
}

/** A path the agent named, the way the computer's tools read it: `~` is home, relative paths start in `cwd`. */
export function computerPath(computer: ComputerDescription, value: string): string {
  const path = pathFlavour(computer)
  if (value === '~' || value.startsWith('~/') || (computer.os === 'windows' && value.startsWith('~\\'))) return path.join(computer.home, value.slice(1))
  return path.isAbsolute(value) ? path.normalize(value) : path.join(computer.cwd, value)
}

export function computerContextNotice(files: Array<{ path: string }> | null, failed: string[] = []): string {
  const lines = [
    '[Pulpo workspace context] This execution runs on the user\'s own computer through the Pulpo desktop app, not in a Pulpo cloud workspace. Historical tool results may describe a different environment, such as an earlier cloud workspace or another computer; inspect files before relying on them.',
  ]
  if (files) lines.push(`Files from this chat saved on the computer:\n${files.length ? files.map((file) => JSON.stringify(file.path)).join('\n') : '(none)'}`)
  if (failed.length) lines.push(`These files could not be saved on the computer:\n${failed.map((path) => JSON.stringify(path)).join('\n')}`)
  return lines.join('\n')
}

export interface ComputerWorkspaceInput {
  responseId: string
  chatId: string
  userId: string
  session: ComputerSessionRef
  /** The computer's description, when the caller already asked for it (the runner does, to write the prompt). */
  described?: Promise<ComputerDescription>
  onLeaseEvent?: WorkspaceLeaseEvent
}

/**
 * "This computer" with full access: the agent's tools run on the user's own computer through the
 * desktop app, over the realtime tunnel. Nothing here touches the workspace controller or
 * `workspace_leases`; the "lease" is just the session, and it costs nothing.
 */
export class ComputerWorkspace implements AgentWorkspace {
  readonly kind = 'computer' as const
  private computer?: ComputerDescription
  private computerPaths?: WorkspacePaths
  private described?: Promise<ComputerDescription>
  private acquisition?: Promise<string>
  private staged = false
  private notice = ''
  private toolsDisabled = false
  private unavailableReported = false
  /** Generated files are tied to this; it names the session, not a `workspace_leases` row. */
  readonly sessionLeaseId: string

  constructor(private readonly input: ComputerWorkspaceInput) {
    this.described = input.described
    this.sessionLeaseId = `computer:${input.session.sessionId}`
  }

  /** Asks the computer what it is once; a failed attempt is forgotten so a later one may succeed. */
  async describe(): Promise<ComputerDescription> {
    if (this.computer) return this.computer
    const described = this.described ??= describeComputer(this.input.session)
    try {
      this.computer = await described
      this.computerPaths = computerWorkspacePaths(this.computer)
      return this.computer
    } catch (error) {
      if (this.described === described) this.described = undefined
      throw error
    }
  }

  get description(): ComputerDescription | undefined { return this.computer }

  get paths(): WorkspacePaths {
    if (!this.computerPaths) throw new Error('The user\'s computer has not been reached yet')
    return this.computerPaths
  }

  async contextNotice(): Promise<string> {
    if (this.notice) return this.notice
    if (this.toolsDisabled) return computerContextNotice(null)
    try {
      await this.describe()
      return computerContextNotice(await loadWorkspaceAttachments(this.input, this.paths))
    } catch {
      return computerContextNotice(null)
    }
  }

  async ensureLease(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (this.toolsDisabled) throw new Error(COMPUTER_UNAVAILABLE_MESSAGE)
    if (this.staged) return this.sessionLeaseId
    this.acquisition ??= this.connect(signal).finally(() => { this.acquisition = undefined })
    return this.acquisition
  }

  private async connect(signal?: AbortSignal): Promise<string> {
    await this.input.onLeaseEvent?.('provisioning')
    try {
      await this.describe()
      await this.stageAttachments(signal)
    } catch (error) {
      if (signal?.aborted) throw error
      throw await this.lost(error)
    }
    this.staged = true
    await this.input.onLeaseEvent?.('ready')
    return this.sessionLeaseId
  }

  /**
   * The computer cannot be used any more: say so on the reply once, and turn the tools off so the
   * model explains instead of retrying commands that cannot run.
   */
  private async lost(error: unknown): Promise<Error> {
    const message = error instanceof ComputerRequestError
      ? `Pulpo could not use the user's computer: ${error.message}`
      : COMPUTER_UNAVAILABLE_MESSAGE
    this.toolsDisabled = true
    if (!this.unavailableReported) {
      this.unavailableReported = true
      await this.input.onLeaseEvent?.('unavailable', { error: message })
    }
    return new Error(message)
  }

  /**
   * Whether the computer is gone for the rest of the reply: unreachable, or its app no longer knows
   * the session (it was restarted, or access was taken back). Every later request would fail the
   * same way, so the tools go off instead of the agent retrying until its tool limit.
   */
  private gone(error: unknown): boolean {
    return error instanceof ComputerUnavailableError || (error instanceof ComputerRequestError && error.code === 'unknown_session')
  }

  /** One request; losing the computer ends its use for the reply. */
  private async call<M extends ComputerMethod>(method: M, params: ComputerParams<M>, options: ComputerCallOptions = {}): Promise<ComputerResult<M>> {
    try { return await computerCall(this.input.session, method, params, options) } catch (error) {
      if (this.gone(error) && !options.signal?.aborted) throw await this.lost(error)
      throw error
    }
  }

  private async stageAttachments(signal?: AbortSignal): Promise<void> {
    const files = await loadWorkspaceAttachments(this.input, this.paths)
    const failed = new Set<string>()
    for (let offset = 0; offset < files.length; offset += STAGE_BATCH) {
      const batch = files.slice(offset, offset + STAGE_BATCH)
      const { missing } = await this.call('file.missing', {
        files: batch.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes, sha256: hexChecksum(file.checksum) ?? null })),
      }, { signal })
      const wanted = new Set(missing)
      for (const file of batch) {
        if (!wanted.has(file.path)) continue
        try {
          const sha256 = hexChecksum(file.checksum)
          if (file.sizeBytes <= COMPUTER_INLINE_MAX_BYTES) {
            const data = await getBlobStore().get(file.objectKey)
            await this.sendFile(file.path, data, data.byteLength, sha256, signal)
          } else {
            const source = await getBlobStore().getStream(file.objectKey)
            try { await this.sendFile(file.path, source, file.sizeBytes, sha256, signal) } finally { source.destroy() }
          }
        } catch (error) {
          // The app refused this one file (no space, a folder in the way): the others are still useful.
          if (!(error instanceof ComputerRequestError)) throw error
          console.warn('Attachment could not be saved on the user\'s computer', { responseId: this.input.responseId, path: file.path, code: error.code })
          failed.add(file.path)
        }
      }
    }
    this.notice = computerContextNotice(files.filter((file) => !failed.has(file.path)), [...failed])
  }

  /** Saves bytes on the computer: inline when small, else through a one-time download URL. */
  private async sendFile(path: string, body: Uint8Array | Readable, sizeBytes: number, sha256: string | undefined, signal?: AbortSignal): Promise<void> {
    const options = { signal, timeoutMs: computerTransferTimeoutMs(sizeBytes) }
    if (body instanceof Uint8Array && sizeBytes <= COMPUTER_INLINE_MAX_BYTES) {
      await this.call('file.receive', { path, data: Buffer.from(body).toString('base64'), sizeBytes, ...(sha256 ? { sha256 } : {}) }, options)
      return
    }
    const download = await createComputerDownload(this.input.session, body, sizeBytes)
    try {
      await this.call('file.receive', { path, transfer: download.transfer, sizeBytes, ...(sha256 ? { sha256 } : {}) }, options)
    } finally { await download.dispose().catch(() => undefined) }
  }

  /** Brings a file from the computer, refusing more than `maxBytes`. */
  private async fetchFile(path: string, maxBytes: number, tooLarge: () => Error, signal?: AbortSignal): Promise<Uint8Array> {
    const upload = await createComputerUpload(this.input.session, { maxBytes })
    try {
      const sent = await this.call('file.send', { path, transfer: upload.transfer, maxBytes }, { signal, timeoutMs: COMPUTER_TRANSFER_TIMEOUT_MS })
      if (sent.sizeBytes > maxBytes) throw tooLarge()
      const data = sent.data !== undefined ? new Uint8Array(Buffer.from(sent.data, 'base64')) : await upload.bytes(maxBytes)
      if (data.byteLength > maxBytes) throw tooLarge()
      return data
    } finally { await upload.dispose().catch(() => undefined) }
  }

  /** Retries a lost poll a few times: operation ids are idempotent, and a socket may reconnect in between. */
  private async poll(id: string, signal?: AbortSignal): Promise<WorkspaceOperation> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await computerCall(this.input.session, 'operation.get', { id, waitMs: LONG_POLL_WAIT_MS }, { signal, timeoutMs: LONG_POLL_TIMEOUT_MS })
      } catch (error) {
        if (signal?.aborted) throw error
        if (error instanceof ComputerRequestError) throw this.gone(error) ? await this.lost(error) : error
        if (attempt >= POLL_ATTEMPTS) throw error instanceof ComputerUnavailableError ? await this.lost(error) : error
        await wait(POLL_RETRY_MS * attempt)
      }
    }
  }

  /**
   * Answers each new `pulpo files` request the app lists, one at a time, as the cloud does.
   * `settled` remembers every request answered in this operation, so none is answered twice: its
   * result while a delivery that failed transiently waits to be resent (only while the app still
   * lists it), else null (delivered, dropped by the app, or refused). Answers go out even after the
   * reply was stopped, because the change they report may already be committed. An answer may wait
   * minutes for the user (a request to browse Files); requests listed meanwhile wait on the app and
   * are answered on the next round. Returns whether a new request was answered.
   */
  private async answerRelay(
    operation: WorkspaceOperation,
    settled: Map<string, RelayResult | null>,
    onRelay: ((request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult>) | undefined,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const pending = operation.relay?.pending ?? []
    const listed = new Set(pending.map((request) => request.id))
    for (const [id, result] of settled) if (result && !listed.has(id)) settled.set(id, null)
    let answered = false
    for (const request of pending) {
      const retry = settled.get(request.id)
      if (retry === null || (!retry && signal?.aborted)) continue
      const result = retry ?? boundRelayResult(onRelay
        ? await onRelay({ id: request.id, command: request.command, args: request.args }, signal)
          .catch((error: unknown): RelayResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false, error: 'Files are not available in this chat' })
      if (!retry) answered = true
      settled.set(request.id, null)
      try {
        // `delivered: false`: the command no longer waits for it (it ended, or gave up); nothing to resend.
        await computerCall(this.input.session, 'operation.relay', { requestId: request.id, result }, { timeoutMs: RELAY_DELIVERY_TIMEOUT_MS })
      } catch (error) {
        const details = { responseId: this.input.responseId, operationId: operation.id, requestId: request.id, error: error instanceof Error ? error.message : String(error) }
        if (error instanceof ComputerRequestError) { console.warn('The user\'s computer refused a relay answer', details); continue }
        if (!retry) console.warn('Relay answer was not delivered to the user\'s computer; retrying', details)
        settled.set(request.id, result)
      }
    }
    return answered
  }

  async execute(
    operationId: string,
    type: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (output: string) => void,
    onStarted?: () => void | Promise<void>,
    onRelay?: (request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult>,
  ): Promise<WorkspaceOperation> {
    await this.ensureLease(signal)
    if (!isOperationType(type)) throw new Error(`${type} is not available on the user's computer`)
    let operation: WorkspaceOperation
    try { operation = await this.call('operation.start', { id: operationId, type, args }, { signal }) } catch (error) {
      if (signal?.aborted) await this.cancel(operationId)
      throw error
    }
    await onStarted?.()
    let previousOutput = ''
    let polledAt = 0
    const settled = new Map<string, RelayResult | null>()
    const stop = async (): Promise<never> => { await this.cancel(operationId); throw signal?.reason ?? new Error('Operation cancelled') }
    while (operation.status === 'running') {
      if (signal?.aborted) await stop()
      if (operation.output !== previousOutput) { previousOutput = operation.output; onUpdate?.(operation.output) }
      const answered = await this.answerRelay(operation, settled, onRelay, signal)
      if (signal?.aborted) await stop()
      // After an answer the app has news at once; otherwise the floor keeps an app that answers instantly from spinning.
      const stale = operation.relay?.pending.some((request) => settled.has(request.id)) ?? false
      if (!answered) await wait(Math.max(0, (stale ? STALE_RELAY_POLL_MS : POLL_FLOOR_MS) - (Date.now() - polledAt)))
      polledAt = Date.now()
      try { operation = await this.poll(operationId, signal) } catch (error) {
        if (signal?.aborted) await stop()
        await this.cancel(operationId)
        throw error
      }
    }
    if (operation.output !== previousOutput) onUpdate?.(operation.output)
    if (operation.status === 'failed') throw new Error(operation.error ?? `${type} failed`)
    return operation
  }

  async viewImage(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceImage> {
    await this.ensureLease(signal)
    const computer = this.current()
    await onStarted?.()
    const bytes = await this.fetchFile(computerPath(computer, path), MAX_VIEW_IMAGE_BYTES, () => new Error(`Image exceeds the ${MAX_VIEW_IMAGE_BYTES} byte limit`), signal)
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new Error('File is not a supported PNG, JPEG, GIF, or WebP image')
    return { data: Buffer.from(bytes).toString('base64'), mimeType, sizeBytes: bytes.byteLength }
  }

  async exportFile(path: string, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<WorkspaceFile> {
    await this.ensureLease(signal)
    const computer = this.current()
    await onStarted?.()
    const data = await this.fetchFile(computerPath(computer, path), MAX_EXPORT_FILE_BYTES, () => new Error(`File exceeds the ${MAX_EXPORT_FILE_BYTES} byte limit`), signal)
    return { data, sizeBytes: data.byteLength }
  }

  /** Whether this computer's app can show other apps' windows and act in them. Known once it was described. */
  get controlsApps(): boolean { return Boolean(this.computer?.apps) }

  /** The apps running on the computer with a window open. */
  async listApps(signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<ComputerApp[]> {
    await this.ensureLease(signal)
    this.current()
    await onStarted?.()
    return (await this.call('app.list', {}, { signal })).apps
  }

  /**
   * Does one thing in an app's window on the computer (`view` only looks) and brings back the
   * window as it is afterwards. The first use of an app waits for the user to allow it there.
   */
  async useApp(input: { app: string; window?: string; action: ComputerAppActionInput }, signal?: AbortSignal, onStarted?: () => void | Promise<void>): Promise<ComputerAppView> {
    await this.ensureLease(signal)
    this.current()
    await onStarted?.()
    const { image, ...state } = await this.call('app.act', input, { signal, timeoutMs: APP_ACT_TIMEOUT_MS })
    const tooLarge = () => new Error(`The picture of the window exceeds the ${MAX_VIEW_IMAGE_BYTES} byte limit`)
    const bytes = image.data !== undefined
      ? new Uint8Array(Buffer.from(image.data, 'base64'))
      : await this.fetchFile(image.path!, MAX_VIEW_IMAGE_BYTES, tooLarge, signal)
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new Error('The computer sent a picture of the window that is not a PNG or JPEG image')
    return { state, image: { data: Buffer.from(bytes).toString('base64'), mimeType, sizeBytes: bytes.byteLength, width: image.width, height: image.height } }
  }

  /**
   * A local path for `pulpo files pull|push`: absolute in this computer's own form, normalised.
   * Anywhere on the computer will do, since a full-access command can reach all of it anyway.
   */
  localPath(value: string): string {
    if (!this.computer) throw new Error('The workspace is not available')
    const windows = this.computer.os === 'windows'
    const absolute = windows ? /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/])/i.test(value) : value.startsWith('/')
    if (!absolute || value.includes('\0')) throw new Error(`"${value}" is not an absolute path on the user's computer`)
    const path = pathFlavour(this.computer)
    const normalized = path.normalize(value)
    const trimmed = normalized.replace(windows ? /[\\/]+$/ : /\/+$/, '')
    // The root keeps its separator: `/`, `C:\`.
    return trimmed.length < path.parse(normalized).root.length ? normalized : trimmed
  }

  /** Relay requests arrive while a command holds the computer, so these never connect anew. */
  private current(): ComputerDescription {
    if (this.toolsDisabled || !this.staged || !this.computer) throw new Error('The workspace is not available')
    return this.computer
  }

  async writeWorkspaceFile(path: string, body: Uint8Array | NodeJS.ReadableStream, sizeBytes: number, signal?: AbortSignal): Promise<void> {
    const target = computerPath(this.current(), path)
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || (body instanceof Uint8Array && body.byteLength !== sizeBytes)) throw new Error('Workspace file size is invalid')
    await this.sendFile(target, body as Uint8Array | Readable, sizeBytes, undefined, signal)
  }

  async readWorkspaceFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    const target = computerPath(this.current(), path)
    return this.fetchFile(target, maxBytes, () => new Error(`${target} is larger than the ${byteLimit(maxBytes)} limit`), signal)
  }

  /** Saves generated bytes on the computer this reply connected to; never connects anew. */
  async saveGeneratedFile(path: string, data: Uint8Array, _mimeType: string, leaseId: string, signal?: AbortSignal): Promise<void> {
    if (!this.computerPaths?.readable(path) || data.byteLength > MAX_EXPORT_FILE_BYTES) throw new Error('Generated workspace file is invalid')
    if (this.toolsDisabled || !this.staged || leaseId !== this.sessionLeaseId) throw new Error('The original image workspace is unavailable')
    await this.sendFile(path, data, data.byteLength, createHash('sha256').update(data).digest('hex'), signal)
  }

  /** Recovery reads only from this reply's own session; a file saved by another one is out of reach. */
  async readGeneratedFile(path: string, leaseId: string, signal?: AbortSignal): Promise<WorkspaceFile> {
    if (leaseId !== this.sessionLeaseId || this.toolsDisabled) throw new Error('The original image workspace is unavailable')
    const computer = await this.describe()
    if (!pathFlavour(computer).isAbsolute(path)) throw new Error('Generated files must be absolute paths')
    const data = await this.fetchFile(path, MAX_EXPORT_FILE_BYTES, () => new Error('Generated file exceeds the export limit'), signal ?? AbortSignal.timeout(COMPUTER_REQUEST_TIMEOUT_MS))
    return { data, sizeBytes: data.byteLength }
  }

  async cancel(operationId: string): Promise<void> {
    if (!this.staged) return
    await computerCall(this.input.session, 'operation.cancel', { id: operationId }, { timeoutMs: CANCEL_TIMEOUT_MS }).catch(() => undefined)
  }

  /** No `workspace_leases` row exists for a computer. */
  get leaseId(): string | undefined { return undefined }
  get continuedWithoutAgent(): boolean { return this.toolsDisabled }
  disableTools(): void { this.toolsDisabled = true }
}
