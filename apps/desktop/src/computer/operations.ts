import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { COMPUTER_OPERATION_OUTPUT_MAX_CHARACTERS, type ComputerOperation, type ComputerOperationType, type ComputerRelayRequest, type ComputerRelayResult } from '@pulpo/contracts'
import { readTextFile, resolveReadableVmPath } from '../../../../packages/workspace-daemon/src/read'
import { saveLargeOutput } from '../../../../packages/workspace-daemon/src/saved-output'
import { ComputerError } from './errors'
import { forceKillGroup, killProcessTree, shellInvocation, type CommandShell, type Spawn, processGroupAlive, stopGroup } from './platform'
import { findFiles, grepFiles } from './search'

/**
 * Full access runs the workspace daemon's operation protocol on the user's computer, with the same
 * semantics (packages/workspace-daemon/src/index.ts): `start` is idempotent by id and returns at
 * once, `get` long-polls for a change, output is cumulative and capped, `cancel` ends the whole
 * process tree. Operations live in memory only; an app restart forgets them.
 *
 * `pulpo files` in a command reaches the server the same way as in the daemon: the CLI's request
 * (relay.ts) is held here, listed on the operation as `relay.pending`, and settled when the server
 * answers with `operation.relay`.
 */

const MAX_COMMAND_OUTPUT_BYTES = 10_000_000
const DEFAULT_TIMEOUT_MS = 600_000
const MAX_TIMEOUT_MS = 3_600_000
const MAX_POLL_WAIT_MS = 25_000
const OUTPUT_POLL_INTERVAL_MS = 250
/** A cancelled command that ignores the polite signal is killed after this long. */
const KILL_GRACE_MS = 5_000
/** Finished operations are kept this long for a final poll, then forgotten. */
const FINISHED_RETENTION_MS = 30 * 60_000
/** The daemon's relay limits: an unanswered request fails after 15 minutes, and after 5 seconds when nobody long-polls. */
const RELAY_TIMEOUT_MS = 900_000
const RELAY_HANDSHAKE_MS = 5_000
/** The contract lists at most this many pending requests on one operation. */
const MAX_PENDING_RELAY = 100
/** The daemon's words, so the agent reads the same thing on the computer as in the cloud. */
export const RELAY_UNAVAILABLE = 'pulpo files only works while the bash command that started it is running'

interface Operation extends ComputerOperation {
  sessionId: string
  completedAt?: number
}

/** `longPolled`: only servers that relay `pulpo files` long-poll, so it tells whether anyone will answer. */
interface LiveOperation { outputRevision: number; servedRevision: number; longPolled: boolean; wake: Set<() => void>; child?: ChildProcess }

/** A `pulpo` command's request, held until the server answers or the command stops. */
interface HeldRelay extends ComputerRelayRequest {
  key: string
  sessionId: string
  /** Answers the CLI once; false when it was already answered. */
  settle: (status: number, value: unknown) => boolean
}

export interface OperationContext {
  sessionId: string
  /** Where relative paths and commands start. */
  cwd: string
  shell: CommandShell
  env: () => Promise<NodeJS.ProcessEnv>
}

export interface OperationsOptions {
  platform: NodeJS.Platform
  /** Large outputs are saved here for the agent to page through. */
  savedOutputDir: string
  /** Windows command scripts are written here and deleted afterwards. */
  scriptDir: string
  spawn?: Spawn
  now?: () => number
  /** How long a cancelled command gets to stop before it is killed; KILL_GRACE_MS unless a test shortens it. */
  killGraceMs?: number
  relayTimeoutMs?: number
  relayHandshakeMs?: number
}

function operationKey(sessionId: string, id: string): string { return `${sessionId}\0${id}` }

/**
 * Output as one answer carries it. Every poll repeats everything printed so far, and an answer is
 * one socket message, so a long output keeps its start and end and loses the middle; the whole of
 * it is saved to a file once the command finishes (`details.fullOutputPath`).
 */
export function outputForAnswer(output: string, maxCharacters = COMPUTER_OPERATION_OUTPUT_MAX_CHARACTERS): string {
  if (output.length <= maxCharacters) return output
  const half = Math.floor(maxCharacters / 2)
  // Never split a surrogate pair at either cut.
  const isLowSurrogate = (index: number) => { const code = output.charCodeAt(index); return code >= 0xdc00 && code <= 0xdfff }
  const headEnd = isLowSurrogate(half) ? half - 1 : half
  const tailStart = isLowSurrogate(output.length - half) ? output.length - half + 1 : output.length - half
  return `${output.slice(0, headEnd)}\n[… ${output.length - headEnd - (output.length - tailStart)} characters left out here …]\n${output.slice(tailStart)}`
}

/** Shows a path relative to where the agent started when it is inside it, else absolute. */
function displayPath(cwd: string, target: string): string {
  const relative = path.relative(cwd, target)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : target
}

export class Operations {
  private readonly operations = new Map<string, Operation>()
  private readonly live = new Map<string, LiveOperation>()
  /** Process groups asked to stop and not yet killed outright, by pid, with the timer that will do it. */
  private readonly stopping = new Map<number, NodeJS.Timeout>()
  /**
   * Process groups of finished commands that left something running (`sleep 60 &`, a dev server),
   * by session. Once its command is over nothing else holds on to such a group, so it is kept here
   * and ended with the session: nothing a reply started outlives the reply, the access it ran
   * under, or the app.
   */
  private readonly leftovers = new Map<string, Set<number>>()
  private readonly relayRequests = new Map<string, HeldRelay>()
  /** Set once the relay endpoint listens; until then answers carry no `relay` and requests are refused. */
  private relayEnabled = false
  private readonly spawn: Spawn
  private readonly now: () => number

  constructor(private readonly options: OperationsOptions) {
    this.spawn = options.spawn ?? nodeSpawn
    this.now = options.now ?? Date.now
  }

  private wake(key: string): void { for (const check of [...this.live.get(key)?.wake ?? []]) check() }

  private pendingRelay(key: string): HeldRelay[] { return [...this.relayRequests.values()].filter((request) => request.key === key) }

  /** Held requests fail once their command stops, and long-polls return at once. */
  private stopped(key: string): void {
    for (const request of this.pendingRelay(key)) request.settle(409, { ok: false, error: RELAY_UNAVAILABLE })
    this.wake(key)
  }

  private view(key: string, operation: Operation): ComputerOperation {
    const state = this.live.get(key); if (state) state.servedRevision = state.outputRevision
    const { id, status, output, exitCode, error, details } = operation
    return {
      id, status, output: outputForAnswer(output), exitCode, ...(error !== undefined ? { error } : {}), ...(details ? { details } : {}),
      ...(this.relayEnabled ? { relay: { version: 1, pending: this.pendingRelay(key).map(({ id: requestId, command, args }) => ({ id: requestId, command, args })) } } : {}),
    }
  }

  /** The relay endpoint is up (or gone): answers say so, and requests are accepted. */
  enableRelay(enabled: boolean): void {
    this.relayEnabled = enabled
    if (!enabled) this.failRelay()
  }

  /** Fails every held request: the app is quitting or the endpoint closed. */
  failRelay(): void { for (const request of [...this.relayRequests.values()]) request.settle(409, { ok: false, error: RELAY_UNAVAILABLE }) }

  /**
   * The command running under this operation id, whatever session it belongs to: the CLI sends only
   * the id. Ids are unique per tool call, so two sessions running the same one means something is
   * wrong, and then neither is chosen.
   */
  private runningCommand(operationId: string): { key: string; operation: Operation } | null {
    let found: { key: string; operation: Operation } | null = null
    for (const [key, operation] of this.operations) {
      if (operation.id !== operationId || operation.status !== 'running') continue
      const child = this.live.get(key)?.child
      if (!child || child.exitCode !== null || child.signalCode !== null) continue
      if (found) return null
      found = { key, operation }
    }
    return found
  }

  /**
   * Holds a `pulpo` command's request until the server answers it (`answerRelay`), its command
   * stops, or it times out; `respond` is called exactly once with the HTTP status and body the CLI
   * gets. Returns what to call when the CLI hangs up first.
   */
  holdRelay(input: { operationId: string; command: string; args: unknown }, respond: (status: number, value: unknown) => void): () => void {
    const target = this.relayEnabled ? this.runningCommand(input.operationId) : null
    if (!target) { respond(409, { ok: false, error: RELAY_UNAVAILABLE }); return () => undefined }
    const { key, operation } = target
    if (this.pendingRelay(key).length >= MAX_PENDING_RELAY) { respond(429, { ok: false, error: 'Too many pulpo commands are waiting at once' }); return () => undefined }
    const state = this.live.get(key)!
    const id = randomUUID()
    const timer = setTimeout(() => settle(504, { ok: false, error: 'Pulpo did not answer in time' }), this.options.relayTimeoutMs ?? RELAY_TIMEOUT_MS)
    // As in the daemon: a server that never long-polls will never answer, so fail fast rather than hold the CLI for the full timeout.
    const handshake = state.longPolled ? undefined : setTimeout(() => {
      if (!state.longPolled) settle(503, { ok: false, error: 'This Pulpo server does not support pulpo files yet' })
    }, this.options.relayHandshakeMs ?? RELAY_HANDSHAKE_MS)
    const forget = () => { clearTimeout(timer); clearTimeout(handshake); return this.relayRequests.delete(id) }
    const settle = (status: number, value: unknown) => {
      if (!this.relayRequests.has(id)) return false
      forget(); respond(status, value); return true
    }
    this.relayRequests.set(id, { id, key, sessionId: operation.sessionId, command: input.command, args: input.args, settle })
    this.wake(key)
    return () => { forget() }
  }

  /** The server's answer to a held request. Only the session whose command made the request may answer it. */
  answerRelay(sessionId: string, requestId: string, result: ComputerRelayResult): boolean {
    const request = this.relayRequests.get(requestId)
    if (!request || request.sessionId !== sessionId) return false
    return request.settle(200, result)
  }

  private find(sessionId: string, id: string): Operation {
    const operation = this.operations.get(operationKey(sessionId, id))
    if (!operation) throw new ComputerError('not_found', `Operation ${id} is unknown on this computer; the Pulpo app may have restarted.`)
    return operation
  }

  private prune(): void {
    const cutoff = this.now() - FINISHED_RETENTION_MS
    for (const [key, operation] of this.operations) if (operation.completedAt !== undefined && operation.completedAt < cutoff) this.operations.delete(key)
  }

  start(context: OperationContext, id: string, type: ComputerOperationType, args: Record<string, unknown>): ComputerOperation {
    this.prune()
    const key = operationKey(context.sessionId, id)
    const existing = this.operations.get(key)
    if (existing) return this.view(key, existing)
    const operation: Operation = { id, sessionId: context.sessionId, status: 'running', output: '', exitCode: null }
    this.operations.set(key, operation)
    this.live.set(key, { outputRevision: 0, servedRevision: 0, longPolled: false, wake: new Set() })
    void this.finish(key, operation, context, type, args)
    return this.view(key, operation)
  }

  /** Waits until the operation stops, a relay request arrives, unseen output is 250 ms into this poll, or waitMs passes. */
  async get(sessionId: string, id: string, waitMs = 0): Promise<ComputerOperation> {
    const key = operationKey(sessionId, id)
    const operation = this.find(sessionId, id)
    const state = this.live.get(key)
    const wait = Math.min(Math.max(0, waitMs), MAX_POLL_WAIT_MS)
    if (wait > 0 && state) state.longPolled = true
    if (wait > 0 && state && operation.status === 'running' && !this.pendingRelay(key).length) {
      const startedAt = this.now()
      await new Promise<void>((done) => {
        let outputTimer: NodeJS.Timeout | undefined
        const finish = () => { clearTimeout(deadline); clearTimeout(outputTimer); state.wake.delete(check); done() }
        const check = () => {
          if (operation.status !== 'running' || this.pendingRelay(key).length) return finish()
          if (state.outputRevision !== state.servedRevision && !outputTimer) outputTimer = setTimeout(finish, Math.max(0, OUTPUT_POLL_INTERVAL_MS - (this.now() - startedAt)))
        }
        const deadline = setTimeout(finish, wait)
        state.wake.add(check)
        check()
      })
    }
    return this.view(key, operation)
  }

  /** `now`: the app is quitting and cannot wait for a command to stop politely. */
  cancel(sessionId: string, id: string, options: { now?: boolean } = {}): ComputerOperation {
    const key = operationKey(sessionId, id)
    const operation = this.find(sessionId, id)
    // As in the daemon: a cancelled operation reports `cancelled` whatever it was doing.
    operation.status = 'cancelled'
    this.stopped(key)
    const child = this.live.get(key)?.child
    if (child) {
      const { platform } = this.options
      const { pid } = child
      killProcessTree(platform, child, options.now ? 'SIGKILL' : 'SIGTERM', this.spawn)
      // A command may ignore the polite signal, or leave something running after its shell is gone.
      if (options.now) forceKillGroup(platform, pid)
      else this.killAfterGrace(pid)
    }
    return this.view(key, operation)
  }

  /** Kills what is left of a process group that was asked to stop, once the grace period is over (or at `killStopping`). */
  private killAfterGrace(pid: number | undefined): void {
    const { platform } = this.options
    if (!pid || platform === 'win32' || this.stopping.has(pid)) return
    const timer = setTimeout(() => { this.stopping.delete(pid); forceKillGroup(platform, pid) }, this.options.killGraceMs ?? KILL_GRACE_MS)
    timer.unref()
    this.stopping.set(pid, timer)
  }

  /**
   * The app is quitting: whatever was asked to stop and is still within its grace period is killed
   * now. Those operations already read `cancelled`, so nothing else would reach them, and the timer
   * that would have killed them dies with the app.
   */
  killStopping(): void {
    for (const [pid, timer] of this.stopping) {
      clearTimeout(timer)
      forceKillGroup(this.options.platform, pid)
    }
    this.stopping.clear()
  }

  /** Ends every running operation of a session whose reply is over, and what its finished commands left running. */
  cancelSession(sessionId: string, options: { now?: boolean } = {}): void {
    for (const [key, operation] of this.operations) {
      if (operation.sessionId !== sessionId) continue
      if (operation.status === 'running') this.cancel(sessionId, operation.id, options)
      if (!this.live.has(key)) this.operations.delete(key)
    }
    const groups = this.leftovers.get(sessionId)
    this.leftovers.delete(sessionId)
    for (const pid of groups ?? []) {
      if (options.now) forceKillGroup(this.options.platform, pid)
      else { stopGroup(this.options.platform, pid); this.killAfterGrace(pid) }
    }
  }

  private async finish(key: string, operation: Operation, context: OperationContext, type: ComputerOperationType, args: Record<string, unknown>): Promise<void> {
    let outputComplete = true
    const cancelled = () => operation.status === 'cancelled'
    try {
      if (type === 'bash') {
        const result = await this.runCommand(key, operation, context, args)
        outputComplete = result.complete
      } else if (type === 'read') {
        const result = await readTextFile(await resolveReadableVmPath(context.cwd, args.path), args)
        operation.output = result.output
        operation.details = result.details
      } else if (type === 'write') {
        if (typeof args.path !== 'string' || !args.path) throw new Error('path must be a non-empty string')
        const target = path.resolve(context.cwd, args.path)
        await mkdir(path.dirname(target), { recursive: true })
        // Cancelled, or its session ended, while the folder was made: the file is left as it was.
        if (!cancelled()) {
          await writeFile(target, String(args.content ?? ''), 'utf8')
          operation.output = `Wrote ${displayPath(context.cwd, target)}`
        }
      } else if (type === 'edit') {
        if (typeof args.path !== 'string' || !args.path) throw new Error('path must be a non-empty string')
        const target = path.resolve(context.cwd, args.path)
        const current = await readFile(target, 'utf8')
        const oldText = String(args.oldText ?? '')
        if (!oldText || !current.includes(oldText)) throw new Error('Edit target was not found')
        // A replacer function keeps `$&` and friends in the new text literal.
        const next = current.replace(oldText, () => String(args.newText ?? ''))
        if (!cancelled()) {
          await writeFile(target, next, 'utf8')
          operation.output = `Edited ${displayPath(context.cwd, target)}`
        }
      } else if (type === 'list') {
        const target = path.resolve(context.cwd, typeof args.path === 'string' && args.path ? args.path : '.')
        operation.output = (await readdir(target, { withFileTypes: true })).map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`).join('\n')
      } else if (type === 'find' || type === 'grep') {
        const result = type === 'find'
          ? await findFiles(context.cwd, args, cancelled, this.options.platform)
          : await grepFiles(context.cwd, args, cancelled)
        operation.output = result.output
        operation.exitCode = result.exitCode
        outputComplete = result.complete
      } else throw new Error(`Unknown operation type: ${String(type)}`)
      if (type === 'bash' || type === 'list' || type === 'find' || type === 'grep') {
        const saved = await saveLargeOutput(this.options.savedOutputDir, operation.id, operation.output, outputComplete)
        if (saved) operation.details = { ...operation.details, ...saved }
      }
      if (!cancelled()) operation.status = 'completed'
    } catch (error) {
      operation.status = cancelled() ? 'cancelled' : 'failed'
      operation.error = error instanceof Error ? error.message : String(error)
    }
    operation.completedAt = this.now()
    this.stopped(key)
    this.live.delete(key)
  }

  private async runCommand(key: string, operation: Operation, context: OperationContext, args: Record<string, unknown>): Promise<{ complete: boolean }> {
    const command = String(args.command ?? '')
    const requestedTimeout = Number(args.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const timeoutMs = Math.min(Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const cwd = path.resolve(context.cwd, typeof args.cwd === 'string' && args.cwd ? args.cwd : '.')
    if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`)
    const platform = this.options.platform
    let scriptPath: string | undefined
    if (platform === 'win32') {
      await mkdir(this.options.scriptDir, { recursive: true })
      scriptPath = path.join(this.options.scriptDir, `${randomBytes(8).toString('hex')}.ps1`)
    }
    const invocation = shellInvocation(platform, context.shell, command, scriptPath)
    if (scriptPath && invocation.script !== undefined) await writeFile(scriptPath, invocation.script, 'utf8')
    const env = { ...await context.env(), PULPO_OPERATION_ID: operation.id, GIT_TERMINAL_PROMPT: '0' }
    let complete = true
    try {
      operation.output = await new Promise<string>((resolveOutput, reject) => {
        if (operation.status === 'cancelled') return resolveOutput('')
        const child = this.spawn(invocation.file, invocation.args, { cwd, env, detached: invocation.detached, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        const state = this.live.get(key); if (state) state.child = child
        const decoder = new StringDecoder('utf8')
        let bytes = 0
        let output = ''
        let timedOut = false
        const collect = (chunk: Buffer) => {
          if (bytes >= MAX_COMMAND_OUTPUT_BYTES) { complete = false; return }
          bytes += chunk.length
          output += decoder.write(chunk)
          operation.output = output
          const live = this.live.get(key); if (live) live.outputRevision += 1
          this.wake(key)
        }
        child.stdout?.on('data', collect); child.stderr?.on('data', collect)
        const timer = setTimeout(() => { timedOut = true; killProcessTree(platform, child, 'SIGKILL', this.spawn) }, timeoutMs)
        child.once('error', (error) => { clearTimeout(timer); reject(error) })
        child.once('close', (code, signal) => {
          clearTimeout(timer)
          // The shell is gone and its output closed, yet something it started may live on in its
          // group. A cancelled or timed-out command's group was already told to stop.
          if (invocation.detached && !timedOut && operation.status !== 'cancelled' && processGroupAlive(platform, child.pid)) {
            const groups = this.leftovers.get(operation.sessionId) ?? new Set<number>()
            groups.add(child.pid!)
            this.leftovers.set(operation.sessionId, groups)
          }
          operation.exitCode = code
          output += decoder.end()
          if (timedOut && operation.status !== 'cancelled') reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)} seconds and was stopped`))
          else if (signal && operation.status !== 'cancelled') reject(new Error(`Command terminated by ${signal}`))
          else resolveOutput(output.replace(/^﻿/, ''))
        })
      })
    } finally {
      if (scriptPath) await rm(scriptPath, { force: true }).catch(() => undefined)
    }
    return { complete }
  }
}
