/** Coalesce before doing any serialization, and never overlap storage writes. */
export function createPersistenceQueue<T>(write: (value: T) => Promise<void>, onError: (error: unknown) => void, delay = 1_000) {
  let pending: { value: T } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const flush = (): Promise<void> => {
    cancelTimer()
    if (running) return running
    running = (async () => {
      // Yield so `running` is assigned even when there is nothing to save.
      await Promise.resolve()
      while (pending) {
        const next = pending
        pending = undefined
        await write(next.value)
      }
    })().finally(() => {
      running = undefined
      // A newer state queued during a failed transaction still needs a save.
      if (pending && timer === undefined) timer = setTimeout(() => { void flush().catch(onError) }, delay)
    })
    return running
  }
  return {
    schedule(value: T) {
      pending = { value }
      if (!running && timer === undefined) {
        timer = setTimeout(() => { void flush().catch(onError) }, delay)
      }
    },
    flush,
    async cancel() {
      cancelTimer()
      pending = undefined
      // A removal must finish after an already-started save, never before it.
      await running?.catch(onError)
    },
  }
}
