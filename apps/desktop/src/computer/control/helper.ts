import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { WINDOWS_SHELL_ARGS, type Spawn } from '../platform'
import { CONTROL_PROTOCOL_VERSION, type ControlErrorCode, type ControlMethod, type ControlParams, type ControlResponse, type ControlResult } from './protocol'

/**
 * The native helper as the main process uses it: started on first use, asked one thing at a time,
 * started again when it died. See protocol.ts for what is said.
 */

/** How to start the helper. */
export interface ControlHelperCommand { file: string; args: string[] }

/** What the helper answered when it could not do what was asked; `message` is written for the agent. */
export class ControlHelperError extends Error {
  constructor(readonly code: ControlErrorCode, message: string) { super(message) }
}

/** A helper is given this long to answer before it is taken for stuck and stopped. */
const REQUEST_TIMEOUT_MS = 20_000
/** Windows compiles its helper each time it starts, so the first answer takes longer. */
const START_TIMEOUT_MS = 45_000
/** A helper nobody has asked anything for this long is stopped; the next request starts another. */
const IDLE_MS = 10 * 60_000
const STDERR_KEPT = 2_000
/** A helper whose input closed gets this long to leave by itself. */
const EXIT_GRACE_MS = 1_500
const STOPPED = 'The helper that controls apps stopped.'
const WITHDRAWN = 'The request was withdrawn before the helper was asked.'

/**
 * Where this system's helper is, or null when there is none: macOS runs the binary built by
 * `scripts/build-control-helper.mjs`, Windows loads the C# beside `host.ps1` with the built-in
 * Windows PowerShell (never PowerShell 7, whose compiler lacks what the helper uses).
 * `directory` holds the helper: the app's resources when packaged, `native/…` in a checkout.
 */
export function controlHelperCommand(platform: NodeJS.Platform, directory: string, env: NodeJS.ProcessEnv, exists: (file: string) => boolean = existsSync): ControlHelperCommand | null {
  if (platform === 'darwin') {
    const binary = path.posix.join(directory, 'pulpo-control')
    return exists(binary) ? { file: binary, args: [] } : null
  }
  if (platform === 'win32') {
    const host = path.win32.join(directory, 'host.ps1')
    if (!exists(host)) return null
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
    const powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return exists(powershell) ? { file: powershell, args: [...WINDOWS_SHELL_ARGS, '-File', host] } : null
  }
  return null
}

export interface ControlHelperOptions {
  command: ControlHelperCommand
  /** Processes the helper must not see: the app itself. */
  excludePids: number[]
  /** Snapshots are written here; the folder is made before the helper starts. */
  imageDir: string
  maxImageEdge: number
  /** Makes `imageDir`. */
  prepare: () => Promise<void>
  spawn?: Spawn
  onError?: (message: string, error: unknown) => void
  requestTimeoutMs?: number
  startTimeoutMs?: number
  idleMs?: number
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

interface Running {
  child: ChildProcess
  pending: Map<number, Pending>
  nextId: number
  stderr: string
  stopped: boolean
}

export class ControlHelper {
  /** The helper process, from the moment it is spawned. */
  private current: Running | null = null
  /** Settles once `current` has been configured and can be asked things. */
  private ready: Promise<Running> | null = null
  /** Counts stops, so a start that was overtaken by one does not go on. */
  private stops = 0
  /** Requests wait here so the helper is asked one thing at a time. */
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | undefined
  private readonly spawn: Spawn

  constructor(private readonly options: ControlHelperOptions) {
    this.spawn = options.spawn ?? nodeSpawn
  }

  /** Ends a helper process and fails whatever was waiting on it. The next request starts another. */
  private end(running: Running, reason: string): void {
    if (this.current === running) { this.current = null; this.ready = null }
    if (running.stopped) return
    running.stopped = true
    for (const waiting of running.pending.values()) { clearTimeout(waiting.timer); waiting.reject(new ControlHelperError('failed', reason)) }
    running.pending.clear()
    // Closing its input is how the helper is told to leave (it puts away the agent's pointer first); the kill is for one that does not listen.
    try { running.child.stdin?.end() } catch { /* already closed */ }
    const { child } = running
    if (child.exitCode !== null || child.signalCode !== null) return
    const kill = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, EXIT_GRACE_MS)
    kill.unref?.()
    child.once('exit', () => clearTimeout(kill))
  }

  private send<M extends ControlMethod>(running: Running, method: M, params: ControlParams<M>, timeoutMs: number): Promise<ControlResult<M>> {
    return new Promise<ControlResult<M>>((resolve, reject) => {
      if (running.stopped) return reject(new ControlHelperError('failed', STOPPED))
      const id = running.nextId++
      // One that does not answer is stuck in a system call it will not leave.
      const timer = setTimeout(() => this.end(running, `The helper that controls apps did not answer ${method} in time and was restarted.`), timeoutMs)
      running.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      running.child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`, (error) => { if (error) this.end(running, STOPPED) })
    })
  }

  private launch(): Running {
    const { command } = this.options
    const child = this.spawn(command.file, command.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const running: Running = { child, pending: new Map(), nextId: 1, stderr: '', stopped: false }
    let buffered = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffered += chunk
      for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
        const line = buffered.slice(0, end).trim()
        buffered = buffered.slice(end + 1)
        if (!line) continue
        let answer: ControlResponse
        try { answer = JSON.parse(line) as ControlResponse } catch { continue }
        const waiting = running.pending.get(answer?.id)
        if (!waiting) continue
        running.pending.delete(answer.id)
        clearTimeout(waiting.timer)
        if (answer.ok) waiting.resolve(answer.result)
        else waiting.reject(new ControlHelperError(answer.code ?? 'failed', String(answer.message ?? 'The request failed.')))
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { running.stderr = (running.stderr + chunk).slice(-STDERR_KEPT) })
    child.stdin?.on('error', () => undefined)
    const gone = (error?: Error) => {
      const unexpected = !running.stopped
      this.end(running, STOPPED)
      if (unexpected) this.options.onError?.('The helper that controls apps stopped', error ?? new Error(running.stderr.trim() || 'It exited.'))
    }
    child.once('error', gone)
    child.once('exit', () => gone())
    return running
  }

  private async start(): Promise<Running> {
    const stops = this.stops
    await this.options.prepare()
    if (stops !== this.stops) throw new ControlHelperError('failed', STOPPED)
    const running = this.launch()
    this.current = running
    const configured = await this.send(running, 'configure', {
      excludePids: this.options.excludePids, imageDir: this.options.imageDir, maxImageEdge: this.options.maxImageEdge,
    }, this.options.startTimeoutMs ?? START_TIMEOUT_MS)
    if (configured?.protocol !== CONTROL_PROTOCOL_VERSION) {
      const reason = 'The helper that controls apps is a different version from the app.'
      this.end(running, reason)
      throw new ControlHelperError('failed', reason)
    }
    return running
  }

  private touch(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), this.options.idleMs ?? IDLE_MS)
    this.idleTimer.unref?.()
  }

  /**
   * Asks the helper one thing, starting it when it is not running. Rejects with a `ControlHelperError`.
   * A request waits its turn behind the one before it; `stillWanted` is asked when its turn comes,
   * and a request nobody wants any more (its reply ended meanwhile) is not sent.
   */
  call<M extends Exclude<ControlMethod, 'configure'>>(method: M, params: ControlParams<M>, options: { timeoutMs?: number; stillWanted?: () => boolean } = {}): Promise<ControlResult<M>> {
    const result = this.queue.then(async () => {
      if (options.stillWanted && !options.stillWanted()) throw new ControlHelperError('failed', WITHDRAWN)
      this.touch()
      if (!this.ready) {
        const ready = this.start()
        this.ready = ready
        // A start that failed is forgotten, so the next request tries again.
        ready.catch(() => { if (this.ready === ready) this.ready = null })
      }
      let running: Running
      try { running = await this.ready } catch (error) {
        throw error instanceof ControlHelperError ? error : new ControlHelperError('failed', `The helper that controls apps could not start: ${error instanceof Error ? error.message : String(error)}`)
      }
      return this.send(running, method, params, options.timeoutMs ?? this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    })
    this.queue = result.catch(() => undefined)
    return result
  }

  /** Whether a helper is running, so nothing starts one only to tell it to hide. */
  get started(): boolean { return this.current !== null }

  /** Stops the helper; the next `call` starts another. */
  stop(): void {
    clearTimeout(this.idleTimer)
    this.stops += 1
    this.ready = null
    if (this.current) this.end(this.current, 'The helper that controls apps was stopped.')
  }
}
