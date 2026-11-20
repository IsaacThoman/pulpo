import { WORKSPACE_SCREEN_FRAME_WAIT_MAX_MS } from '@pulpo/contracts'

/**
 * One answer of `…/workspace-screen/frame`. `gone`: the chat has no running workspace with a
 * screen. `unfunded`: the user cannot pay for the next minute with the screen open (HTTP 402).
 */
export type FrameAnswer =
  | { kind: 'frame'; id: string; bytes: Uint8Array }
  | { kind: 'unchanged' }
  | { kind: 'gone' }
  | { kind: 'unfunded' }

export type FrameFetch = (after: string | undefined, waitMs: number, signal: AbortSignal) => Promise<FrameAnswer>

export interface FrameLoopOptions {
  fetchFrame: FrameFetch
  onFrame: (frame: { id: string; bytes: Uint8Array }) => void
  /** The workspace went away; the loop has stopped. */
  onGone: () => void
  /** The screen can't stay open until the user can pay for it; the loop has stopped and does not retry. */
  onUnfunded: () => void
  /** Requests started failing (false) or answer again (true). Called on changes only. */
  onConnection: (connected: boolean) => void
  waitMs?: number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export interface FrameLoop {
  stop: () => void
  /** Settles when the loop has ended, after `stop`, once the workspace is gone or once it is unfunded. */
  done: Promise<void>
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/** How long to wait after `failures` failed requests in a row. */
export function frameRetryDelay(failures: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(0, failures - 1), RETRY_DELAYS_MS.length - 1)]!
}

function sleepFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Asks for the screen's picture again and again. Each request waits until the picture differs
 * from the last one shown (`after`), so a still screen costs one request every `waitMs`. Failures
 * back off; `stop` cancels the request in flight.
 */
export function startFrameLoop(options: FrameLoopOptions): FrameLoop {
  const controller = new AbortController()
  const { signal } = controller
  const waitMs = options.waitMs ?? WORKSPACE_SCREEN_FRAME_WAIT_MAX_MS
  const sleep = options.sleep ?? sleepFor
  const done = (async () => {
    let after: string | undefined
    let failures = 0
    while (!signal.aborted) {
      let answer: FrameAnswer
      try {
        answer = await options.fetchFrame(after, waitMs, signal)
      } catch {
        if (signal.aborted) return
        failures += 1
        if (failures === 1) options.onConnection(false)
        await sleep(frameRetryDelay(failures), signal)
        continue
      }
      if (signal.aborted) return
      if (failures > 0) {
        failures = 0
        options.onConnection(true)
      }
      if (answer.kind === 'gone') {
        options.onGone()
        return
      }
      if (answer.kind === 'unfunded') {
        options.onUnfunded()
        return
      }
      if (answer.kind === 'frame') {
        after = answer.id
        options.onFrame({ id: answer.id, bytes: answer.bytes })
      }
    }
  })()
  return { stop: () => controller.abort(), done }
}
