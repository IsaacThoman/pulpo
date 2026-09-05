/** HTTP outbox recovery must not depend on the realtime transport being connected. */
export function createOutboxScheduler(options: {
  isActive: () => boolean
  flush: () => Promise<number | null>
  onError: (error: unknown) => void
}) {
  let disposed = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (delay = 1_000) => {
    if (disposed || !options.isActive()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void flush() }, delay)
  }
  const flush = async () => {
    if (disposed || running || !options.isActive()) return
    running = true
    try {
      const delay = await options.flush()
      if (delay !== null) schedule(delay)
    } catch (error) {
      if (!disposed) options.onError(error)
      schedule(5_000)
    } finally {
      running = false
    }
  }
  return {
    schedule,
    flush,
    dispose: () => { disposed = true; if (timer) clearTimeout(timer) },
  }
}
