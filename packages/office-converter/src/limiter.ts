export class BusyError extends Error {}

/**
 * Runs at most `concurrency` jobs at once and queues at most `maxQueued` more. Beyond that it
 * refuses at once, so callers back off instead of piling up requests that would time out.
 */
export class JobLimiter {
  private running = 0
  private readonly waiting: Array<{ start: () => void; signal?: AbortSignal; cancel: () => void }> = []

  constructor(private readonly concurrency: number, private readonly maxQueued: number) {}

  get stats(): { running: number; queued: number } {
    return { running: this.running, queued: this.waiting.length }
  }

  async run<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.running >= this.concurrency) {
      if (this.waiting.length >= this.maxQueued) throw new BusyError('The converter is busy')
      await new Promise<void>((resolve, reject) => {
        const entry = {
          signal,
          start: () => { signal?.removeEventListener('abort', entry.cancel); resolve() },
          // A request that went away while queued gives up its place.
          cancel: () => {
            const index = this.waiting.indexOf(entry)
            if (index >= 0) this.waiting.splice(index, 1)
            reject(signal?.reason ?? new Error('aborted'))
          },
        }
        signal?.addEventListener('abort', entry.cancel, { once: true })
        this.waiting.push(entry)
      })
    } else {
      this.running += 1
    }
    try {
      return await job()
    } finally {
      const next = this.waiting.shift()
      // The slot passes straight to the next job, so `running` never dips and lets a newcomer jump the queue.
      if (next) next.start()
      else this.running -= 1
    }
  }
}
