import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readTextFile } from '../read.js'
import type { PathPolicy } from './path-policy.js'
import { runSearch } from './search.js'
import { killTree, shellSpawnSpec, spawnShell, type ShellKind } from './shell.js'

export type OperationStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface Operation {
  id: string
  status: OperationStatus
  output: string
  exitCode: number | null
  error?: string
  details?: Record<string, unknown>
  startedAt: string
  completedAt?: string
}

export type OperationType = 'bash' | 'read' | 'write' | 'edit' | 'list' | 'find' | 'grep' | 'stat'

export interface OperationRunnerOptions {
  policy: PathPolicy
  shell: ShellKind
  /** Environment for shell commands. Defaults to the daemon's own environment. */
  env?: NodeJS.ProcessEnv
  /** Directory where operation journals persist across restarts. */
  journalDir: string
  /** Absolute path to a ripgrep binary. When omitted, a pure-Node search fallback runs. */
  /** Optional traversal filter for workspaces with private managed directories. */
  searchPathAllowed?: (path: string) => Promise<boolean>
  rgPath?: string
  maxOutputBytes?: number
  maxTimeoutMs?: number
  defaultTimeoutMs?: number
  platform?: NodeJS.Platform
  /** Invoked whenever an operation changes; useful for pushing progress to a caller. */
  onChange?: (operation: Operation) => void
}

const DEFAULT_MAX_OUTPUT_BYTES = 10_000_000
const DEFAULT_MAX_TIMEOUT_MS = 3_600_000
const DEFAULT_TIMEOUT_MS = 600_000

/**
 * Executes agent workspace operations with a journal keyed by the caller's operation id, so a
 * retried request after a crash returns the recorded outcome instead of running twice.
 */
export class OperationRunner {
  private readonly operations = new Map<string, Operation>()
  private readonly children = new Map<string, ChildProcess>()
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly platform: NodeJS.Platform
  private readonly maxOutputBytes: number
  private readonly maxTimeoutMs: number
  private readonly defaultTimeoutMs: number

  constructor(private readonly options: OperationRunnerOptions) {
    this.platform = options.platform ?? process.platform
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  get policy(): PathPolicy { return this.options.policy }

  private journalPath(id: string): string {
    return resolve(this.options.journalDir, `${createHash('sha256').update(id).digest('hex')}.json`)
  }

  private async save(operation: Operation): Promise<void> {
    await mkdir(this.options.journalDir, { recursive: true })
    await writeFile(this.journalPath(operation.id), JSON.stringify(operation), 'utf8')
    this.options.onChange?.(operation)
  }

  async find(id: string): Promise<Operation | undefined> {
    const current = this.operations.get(id)
    if (current) return current
    try {
      const stored = JSON.parse(await readFile(this.journalPath(id), 'utf8')) as Operation
      if (stored.status === 'running') {
        stored.status = 'failed'
        stored.error = 'Operation outcome is unknown after daemon restart'
        stored.completedAt = new Date().toISOString()
        await this.save(stored)
      }
      this.operations.set(id, stored)
      return stored
    } catch {
      return undefined
    }
  }

  async execute(id: string, type: string, args: Record<string, unknown>): Promise<Operation> {
    const existing = await this.find(id)
    if (existing) return existing
    const operation: Operation = { id, status: 'running', output: '', exitCode: null, startedAt: new Date().toISOString() }
    this.operations.set(id, operation)
    await this.save(operation)
    void this.finish(operation, type, args)
    return operation
  }

  async cancel(id: string): Promise<Operation | undefined> {
    const operation = await this.find(id)
    if (!operation) return undefined
    if (operation.status !== 'running') return operation
    operation.status = 'cancelled'
    this.abortControllers.get(id)?.abort()
    const child = this.children.get(id)
    if (child) killTree(child, 'SIGTERM', this.platform)
    await this.save(operation)
    return operation
  }

  /** Cancel every running operation, used when the workspace is disabled or shutting down. */
  async cancelAll(): Promise<void> {
    const running = [...this.operations.values()].filter((operation) => operation.status === 'running')
    await Promise.all(running.map((operation) => this.cancel(operation.id)))
  }

  private async finish(operation: Operation, type: string, args: Record<string, unknown>): Promise<void> {
    const { policy } = this.options
    try {
      switch (type as OperationType) {
        case 'bash': operation.output = await this.runShell(operation, args); break
        case 'read': {
          const target = await policy.readable(args.path)
          if (!(await stat(target)).isFile()) throw new Error('Path must be a regular file')
          const result = await readTextFile(target, args)
          operation.output = result.output
          operation.details = result.details
          break
        }
        case 'write': {
          const path = await policy.writableChecked(args.path)
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, String(args.content ?? ''), 'utf8')
          operation.output = `Wrote ${policy.path.relative(policy.root, path)}`
          break
        }
        case 'edit': {
          const path = await policy.writableChecked(args.path)
          const current = await readFile(path, 'utf8')
          const oldText = String(args.oldText ?? '')
          if (!oldText || !current.includes(oldText)) throw new Error('Edit target was not found')
          await writeFile(path, current.replace(oldText, String(args.newText ?? '')), 'utf8')
          operation.output = `Edited ${policy.path.relative(policy.root, path)}`
          break
        }
        case 'list': {
          const path = await policy.readable(args.path ?? '.')
          operation.output = (await readdir(path, { withFileTypes: true })).filter((entry) => policy.isReadable(policy.path.join(path, entry.name))).map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`).join('\n')
          break
        }
        case 'find':
        case 'grep': {
          const controller = new AbortController()
          this.abortControllers.set(operation.id, controller)
          try {
            const result = await runSearch({
              type: type as 'find' | 'grep', pattern: String(args.pattern ?? (type === 'find' ? '*' : '')),
              path: await policy.readable(args.path ?? '.'), cwd: policy.root,
              pathAllowed: this.options.searchPathAllowed, rgPath: this.options.rgPath, maxOutputBytes: this.maxOutputBytes, signal: controller.signal,
            })
            operation.output = result.output
            operation.exitCode = result.exitCode
          } finally {
            this.abortControllers.delete(operation.id)
          }
          break
        }
        case 'stat': operation.output = JSON.stringify(await stat(await policy.readable(args.path))); break
        default: throw new Error(`Unknown operation type: ${type}`)
      }
      if (operation.status !== 'cancelled') operation.status = 'completed'
    } catch (error) {
      operation.status = operation.status === 'cancelled' ? 'cancelled' : 'failed'
      operation.error = error instanceof Error ? error.message : String(error)
    }
    operation.completedAt = new Date().toISOString()
    await this.save(operation)
  }

  private runShell(operation: Operation, args: Record<string, unknown>): Promise<string> {
    const command = String(args.command ?? '')
    const requestedTimeout = Number(args.timeoutMs ?? this.defaultTimeoutMs)
    const timeoutMs = Math.min(Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : this.defaultTimeoutMs, this.maxTimeoutMs)
    const cwd = this.options.policy.writable(args.cwd ?? '.')
    const env = this.options.env ?? process.env
    return new Promise<string>((resolveOutput, reject) => {
      const child = spawnShell(shellSpawnSpec(this.options.shell, command, env), { cwd, env })
      this.children.set(operation.id, child)
      const chunks: Buffer[] = []
      let bytes = 0
      const collect = (chunk: Buffer) => {
        if (bytes >= this.maxOutputBytes) return
        chunks.push(chunk)
        bytes += chunk.length
        operation.output = Buffer.concat(chunks).toString('utf8')
        this.options.onChange?.(operation)
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      const timer = setTimeout(() => killTree(child, 'SIGKILL', this.platform), timeoutMs)
      child.once('error', (error) => { clearTimeout(timer); this.children.delete(operation.id); reject(error) })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        this.children.delete(operation.id)
        operation.exitCode = code
        const output = Buffer.concat(chunks).toString('utf8')
        if (signal && operation.status !== 'cancelled') reject(new Error(`Command terminated by ${signal}`))
        else resolveOutput(output)
      })
    })
  }
}
