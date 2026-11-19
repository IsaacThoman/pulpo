import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { COMPUTER_OPERATION_OUTPUT_MAX_CHARACTERS, type ComputerOperation, type ComputerOperationType } from '@pulpo/contracts'
import { readTextFile, resolveReadableVmPath } from '../../../../packages/workspace-daemon/src/read'
import { saveLargeOutput } from '../../../../packages/workspace-daemon/src/saved-output'
import { ComputerError } from './errors'
import { killProcessTree, shellInvocation, type CommandShell, type Spawn } from './platform'
import { findFiles, grepFiles } from './search'

/**
 * Full access runs the workspace daemon's operation protocol on the user's computer, with the same
 * semantics (packages/workspace-daemon/src/index.ts): `start` is idempotent by id and returns at
 * once, `get` long-polls for a change, output is cumulative and capped, `cancel` ends the whole
 * process tree. Operations live in memory only; an app restart forgets them.
 */

const MAX_COMMAND_OUTPUT_BYTES = 10_000_000
const DEFAULT_TIMEOUT_MS = 600_000
const MAX_TIMEOUT_MS = 3_600_000
const MAX_POLL_WAIT_MS = 25_000
const OUTPUT_POLL_INTERVAL_MS = 250
/** Finished operations are kept this long for a final poll, then forgotten. */
const FINISHED_RETENTION_MS = 30 * 60_000

interface Operation extends ComputerOperation {
  sessionId: string
  completedAt?: number
}

interface LiveOperation { outputRevision: number; servedRevision: number; wake: Set<() => void>; child?: ChildProcess }

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
  private readonly spawn: Spawn
  private readonly now: () => number

  constructor(private readonly options: OperationsOptions) {
    this.spawn = options.spawn ?? nodeSpawn
    this.now = options.now ?? Date.now
  }

  private wake(key: string): void { for (const check of [...this.live.get(key)?.wake ?? []]) check() }

  private view(key: string, operation: Operation): ComputerOperation {
    const state = this.live.get(key); if (state) state.servedRevision = state.outputRevision
    const { id, status, output, exitCode, error, details } = operation
    return { id, status, output: outputForAnswer(output), exitCode, ...(error !== undefined ? { error } : {}), ...(details ? { details } : {}) }
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
    this.live.set(key, { outputRevision: 0, servedRevision: 0, wake: new Set() })
    void this.finish(key, operation, context, type, args)
    return this.view(key, operation)
  }

  /** Waits until the operation stops, unseen output is 250 ms into this poll, or waitMs passes. */
  async get(sessionId: string, id: string, waitMs = 0): Promise<ComputerOperation> {
    const key = operationKey(sessionId, id)
    const operation = this.find(sessionId, id)
    const state = this.live.get(key)
    const wait = Math.min(Math.max(0, waitMs), MAX_POLL_WAIT_MS)
    if (wait > 0 && state && operation.status === 'running') {
      const startedAt = this.now()
      await new Promise<void>((done) => {
        let outputTimer: NodeJS.Timeout | undefined
        const finish = () => { clearTimeout(deadline); clearTimeout(outputTimer); state.wake.delete(check); done() }
        const check = () => {
          if (operation.status !== 'running') return finish()
          if (state.outputRevision !== state.servedRevision && !outputTimer) outputTimer = setTimeout(finish, Math.max(0, OUTPUT_POLL_INTERVAL_MS - (this.now() - startedAt)))
        }
        const deadline = setTimeout(finish, wait)
        state.wake.add(check)
        check()
      })
    }
    return this.view(key, operation)
  }

  cancel(sessionId: string, id: string): ComputerOperation {
    const key = operationKey(sessionId, id)
    const operation = this.find(sessionId, id)
    // As in the daemon: a cancelled operation reports `cancelled` whatever it was doing.
    operation.status = 'cancelled'
    this.wake(key)
    const child = this.live.get(key)?.child
    if (child) killProcessTree(this.options.platform, child, 'SIGTERM', this.spawn)
    return this.view(key, operation)
  }

  /** Ends every running operation of a session whose reply is over. */
  cancelSession(sessionId: string): void {
    for (const [key, operation] of this.operations) {
      if (operation.sessionId !== sessionId) continue
      if (operation.status === 'running') this.cancel(sessionId, operation.id)
      if (!this.live.has(key)) this.operations.delete(key)
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
        await writeFile(target, String(args.content ?? ''), 'utf8')
        operation.output = `Wrote ${displayPath(context.cwd, target)}`
      } else if (type === 'edit') {
        if (typeof args.path !== 'string' || !args.path) throw new Error('path must be a non-empty string')
        const target = path.resolve(context.cwd, args.path)
        const current = await readFile(target, 'utf8')
        const oldText = String(args.oldText ?? '')
        if (!oldText || !current.includes(oldText)) throw new Error('Edit target was not found')
        // A replacer function keeps `$&` and friends in the new text literal.
        const next = current.replace(oldText, () => String(args.newText ?? ''))
        await writeFile(target, next, 'utf8')
        operation.output = `Edited ${displayPath(context.cwd, target)}`
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
    this.wake(key)
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
