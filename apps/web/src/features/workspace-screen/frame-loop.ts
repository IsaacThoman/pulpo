/**
 * The live picture of a workspace's screen: one frame request after another, each waiting on the
 * server until the picture differs from the one shown. The loop knows nothing of React or the
 * network; the viewer passes it how to fetch a frame and what to do with one.
 */

export type FrameAnswer =
  /** A new picture and its id, sent back as `after` to wait for the next one. */
  | { kind: 'frame'; id: string | null; image: Blob }
  /** The picture did not change while the request waited. */
  | { kind: 'unchanged' }
  /** The workspace is gone, or no longer has a screen. */
  | { kind: 'gone' }
  /** The user is out of credit for watching; the loop stops and is not started again by itself. */
  | { kind: 'unfunded' }

export interface FrameLoopOptions {
  fetchFrame: (after: string | undefined, waitMs: number, signal: AbortSignal) => Promise<FrameAnswer>
  onFrame: (image: Blob, id: string | null) => void
  onGone: () => void
  onUnfunded: () => void
  /** A request failed and the loop is waiting before it asks again; `failures` counts them in a row. */
  onError?: (error: unknown, failures: number) => void
  /** The loop got a picture or an answer again after failing. */
  onRecovered?: () => void
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** How long each request may wait on the server for the picture to change. */
  waitMs?: number
}

export const FRAME_WAIT_MS = 8_000
/** A frame without an id cannot be waited past, so the next one is asked for after this pause instead of at once. */
const UNNAMED_FRAME_PAUSE_MS = 250
const BACKOFF_FIRST_MS = 500
const BACKOFF_MAX_MS = 10_000

/** The wait before asking again after `failures` failed requests in a row: doubling, up to ten seconds. */
export function frameBackoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, failures - 1))
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return }
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Asks for frames until `signal` aborts, the workspace is gone, or the user is out of credit. `after` is the picture already
 * shown when the loop starts again (after the page was hidden, say), so it is not sent twice.
 */
export async function runFrameLoop(options: FrameLoopOptions, signal: AbortSignal, after?: string): Promise<void> {
  const sleep = options.sleep ?? abortableSleep
  const waitMs = options.waitMs ?? FRAME_WAIT_MS
  let last = after
  let failures = 0
  while (!signal.aborted) {
    let answer: FrameAnswer
    try {
      // The first request answers at once with whatever is on the screen.
      answer = await options.fetchFrame(last, last ? waitMs : 0, signal)
    } catch (error) {
      if (signal.aborted) return
      failures += 1
      options.onError?.(error, failures)
      await sleep(frameBackoffMs(failures), signal)
      continue
    }
    if (signal.aborted) return
    if (failures > 0) {
      failures = 0
      options.onRecovered?.()
    }
    if (answer.kind === 'gone') {
      options.onGone()
      return
    }
    if (answer.kind === 'unfunded') {
      options.onUnfunded()
      return
    }
    if (answer.kind === 'unchanged') continue
    last = answer.id ?? undefined
    options.onFrame(answer.image, answer.id)
    if (!answer.id) await sleep(UNNAMED_FRAME_PAUSE_MS, signal)
  }
}
