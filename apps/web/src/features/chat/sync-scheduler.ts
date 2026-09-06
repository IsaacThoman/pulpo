/** Collapse a wakeup burst and retain one follow-up if state changes during sync. */
export function createSyncScheduler(sync: () => Promise<void>, onError: (error: unknown) => void, delay = 100) {
  let disposed = false
  let requested = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (disposed || running || timer !== undefined || !requested) return
    timer = setTimeout(() => {
      timer = undefined
      requested = false
      running = true
      void sync().catch(onError).finally(() => {
        running = false
        schedule()
      })
    }, delay)
  }
  return {
    request() { requested = true; schedule() },
    dispose() {
      disposed = true
      requested = false
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
