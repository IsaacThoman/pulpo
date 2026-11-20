import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'

/**
 * The live picture of the workspace's screen and who is using it. The picture comes from
 * `pulpo-desktop frames`, started when someone asks for a frame and stopped when nobody has for a
 * while. Control is held by the chat's owner while they use the screen themselves; the daemon only
 * keeps when it lapses, and the server decides who may take it.
 */

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface Frame { id: string; data: Buffer }

/** The first 32 hex characters of the SHA-256 of the picture; the server computes the same from the bytes it relays. */
export function frameId(data: Buffer): string { return createHash('sha256').update(data).digest('hex').slice(0, 32) }

const HEADER_END = Buffer.from('\r\n\r\n')
const MAX_HEADER_BYTES = 4_096
const MAX_FRAME_BYTES = 16 * 1024 * 1024

/**
 * Reads ffmpeg's `mpjpeg` stream: each part is a few header lines, one of them `Content-Length`,
 * a blank line, then exactly that many bytes of JPEG. Parts arrive split across chunks however the
 * pipe cuts them. The boundary line is a header line like the others, so it needs no handling.
 */
export class MultipartJpegParser {
  private buffered: Buffer = Buffer.alloc(0)
  /** The length of the part being read, once its headers are in. */
  private length: number | null = null

  /** Throws when the stream is not one this can read; the caller stops it. */
  push(chunk: Buffer): Buffer[] {
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk
    const frames: Buffer[] = []
    for (;;) {
      if (this.length === null) {
        // The line break that ends the previous part's bytes.
        let start = 0
        while (start < this.buffered.length && (this.buffered[start] === 0x0d || this.buffered[start] === 0x0a)) start += 1
        if (start) this.buffered = this.buffered.subarray(start)
        const end = this.buffered.indexOf(HEADER_END)
        if (end < 0) {
          if (this.buffered.length > MAX_HEADER_BYTES) throw new Error('The screen stream sent a part without the end of its headers.')
          break
        }
        const headers = this.buffered.subarray(0, end).toString('latin1')
        const match = /^content-length:[ \t]*(\d+)[ \t]*$/im.exec(headers)
        if (!match) throw new Error('The screen stream sent a part without a Content-Length.')
        const length = Number(match[1])
        if (!Number.isSafeInteger(length) || length > MAX_FRAME_BYTES) throw new Error('The screen stream sent a part that is too large.')
        this.length = length
        this.buffered = this.buffered.subarray(end + HEADER_END.length)
      }
      if (this.buffered.length < this.length) break
      if (this.length > 0) frames.push(Buffer.from(this.buffered.subarray(0, this.length)))
      this.buffered = this.buffered.subarray(this.length)
      this.length = null
    }
    return frames
  }
}

/** A stream nobody asked a frame of for this long is stopped. */
const IDLE_MS = 15_000
/** How long a request waits for the first picture of a stream before it fails. */
const FIRST_FRAME_MS = 5_000
/** A stream that ended is not started again sooner than this, however often frames are asked for. */
const RESTART_MS = 1_000
const FRAMES_PER_SECOND = 4
const STDERR_KEPT = 2_000

export const FRAME_TIMEOUT = "The workspace's screen did not send a picture in time."
export const FRAME_STOPPED = "The workspace's screen stopped sending pictures."

export interface FrameStreamOptions {
  /** `pulpo-desktop`; run as `<command> frames <fps>`. */
  command: string
  spawn?: Spawn
  fps?: number
  idleMs?: number
  firstFrameMs?: number
  restartMs?: number
  onError?: (message: string) => void
}

/** The latest picture of the screen, kept while someone is watching. */
export class FrameStream {
  private child: ChildProcess | null = null
  /** The latest frame of the running stream; a stream that ends takes its frame with it, since the screen goes on changing. */
  private latest: Frame | null = null
  private lastStart = -Infinity
  private idleTimer: NodeJS.Timeout | undefined
  private readonly waiters = new Set<() => void>()
  private readonly spawn: Spawn

  constructor(private readonly options: FrameStreamOptions) {
    this.spawn = options.spawn ?? nodeSpawn
  }

  get running(): boolean { return this.child !== null }

  private wake(): void { for (const waiter of [...this.waiters]) waiter() }

  private start(): void {
    if (this.child || Date.now() - this.lastStart < (this.options.restartMs ?? RESTART_MS)) return
    this.lastStart = Date.now()
    // Its own process group, so stopping it also stops whatever it runs to capture the screen.
    const child = this.spawn(this.options.command, ['frames', String(this.options.fps ?? FRAMES_PER_SECOND)], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    this.child = child
    const parser = new MultipartJpegParser()
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      let frames: Buffer[]
      try { frames = parser.push(chunk) } catch (error) { return this.end(child, error instanceof Error ? error.message : String(error)) }
      const data = frames.at(-1)
      if (!data) return
      const id = frameId(data)
      if (this.latest?.id === id) return
      this.latest = { id, data }
      this.wake()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_KEPT) })
    child.once('error', (error) => this.end(child, error.message))
    child.once('exit', (code, signal) => this.end(child, `It exited (${signal ?? code}). ${stderr.trim()}`.trim()))
  }

  private end(child: ChildProcess, reason?: string): void {
    if (this.child !== child) return
    this.child = null
    this.latest = null
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
    if (reason) this.options.onError?.(`The screen stream stopped: ${reason}`)
    this.wake()
  }

  private touch(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), this.options.idleMs ?? IDLE_MS)
    this.idleTimer.unref?.()
  }

  stop(): void {
    clearTimeout(this.idleTimer)
    if (this.child) this.end(this.child)
  }

  /**
   * The latest frame once its id differs from `after` (at once when it already does), else null
   * after `waitMs`. The stream is started when it is not running; its first picture is waited for
   * a few seconds even by a request that would not wait, and a stream that sends none fails the request.
   */
  async next(after: string | undefined, waitMs: number, signal?: AbortSignal): Promise<Frame | null> {
    this.touch()
    try {
      this.start()
      const fresh = () => this.latest && this.latest.id !== after ? this.latest : null
      const now = fresh()
      if (now) return now
      const startedAt = Date.now()
      const firstFrameMs = this.options.firstFrameMs ?? FIRST_FRAME_MS
      return await new Promise<Frame | null>((resolve, reject) => {
        const timers: NodeJS.Timeout[] = []
        const finish = (settle: () => void) => {
          for (const timer of timers) clearTimeout(timer)
          this.waiters.delete(check)
          signal?.removeEventListener('abort', check)
          settle()
        }
        const check = () => {
          const frame = fresh()
          if (frame) return finish(() => resolve(frame))
          if (signal?.aborted) return finish(() => resolve(null))
          const elapsed = Date.now() - startedAt
          if (!this.latest) {
            if (!this.child) return finish(() => reject(new Error(FRAME_STOPPED)))
            if (elapsed >= firstFrameMs) return finish(() => reject(new Error(FRAME_TIMEOUT)))
          } else if (elapsed >= waitMs) return finish(() => resolve(null))
        }
        this.waiters.add(check)
        signal?.addEventListener('abort', check)
        timers.push(setTimeout(check, waitMs), setTimeout(check, firstFrameMs))
        check()
      })
    } finally { this.touch() }
  }
}

/** Control lapses this long after it was taken or renewed. From WORKSPACE_SCREEN_CONTROL_TTL_MS in packages/contracts/src/workspace-screen.ts. */
export const CONTROL_TTL_MS = 20_000

/** Whether the chat's owner is using the screen themselves: held by renewing it, lost by itself when they go away. */
export class ScreenControl {
  private until = 0

  constructor(private readonly ttlMs = CONTROL_TTL_MS, private readonly now: () => number = Date.now) {}

  get held(): boolean { return this.now() < this.until }

  /** Takes control or renews it. */
  take(): void { this.until = this.now() + this.ttlMs }

  release(): void { this.until = 0 }
}
