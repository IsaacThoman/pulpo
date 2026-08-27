export interface CancellationWatcher {
  signal: AbortSignal
  stop: () => void
}

export function watchCancellation(
  isCancelled: () => Promise<boolean>,
  intervalMs = 500,
): CancellationWatcher {
  const controller = new AbortController()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const poll = async () => {
    try {
      if (!stopped && await isCancelled()) controller.abort(new Error('Episodic memory indexing was cancelled'))
    } catch {
      // A transient database error must not mask the embedding operation's own result.
    }
    if (!stopped && !controller.signal.aborted) timer = setTimeout(() => { void poll() }, intervalMs)
  }
  void poll()

  return {
    signal: controller.signal,
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
