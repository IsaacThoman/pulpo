/** A bounded, coalescing queue. Failed batches are dropped, never retried into user work. */
export class DiagnosticWriter {
  private pending = new Map<string, string>()
  private bytes = 0
  private running: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  droppedRecords = 0
  constructor(private persist: (rows: string[]) => Promise<void>, private report: (event: string, count: number) => void,
    private limits = { records: 128, bytes: 16 * 1024 * 1024, batch: 16 }) {}
  enqueue(id: string, value: unknown): void {
    try {
      const text = JSON.stringify(value), size = Buffer.byteLength(text)
      const previous = this.pending.get(id), previousSize = previous ? Buffer.byteLength(previous) : 0
      if (this.stopped || (!previous && this.pending.size >= this.limits.records) || this.bytes - previousSize + size > this.limits.bytes) {
        this.drop('queue_full', 1); return
      }
      this.pending.set(id, text); this.bytes += size - previousSize
      if (!this.timer && !this.running) {
        this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 25)
        this.timer.unref()
      }
    } catch { this.drop('serialization_failed', 1) }
  }
  private drop(event: string, count: number) { this.droppedRecords += count; try { this.report(event, count) } catch {} }
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    if (this.running) return this.running
    this.running = (async () => {
      while (this.pending.size) {
        const batch = [...this.pending.entries()].slice(0, this.limits.batch)
        for (const [id, value] of batch) { this.pending.delete(id); this.bytes -= Buffer.byteLength(value) }
        try { await this.persist(batch.map(([, value]) => value)) } catch { this.drop('write_failed', batch.length) }
      }
    })()
    try { await this.running } finally {
      this.running = undefined
      // Enqueue can race the final await after the loop observed an empty queue.
      if (this.pending.size && !this.timer && !this.stopped) {
        this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 25)
        this.timer.unref()
      }
    }
  }
  async close(timeoutMs = 2000): Promise<void> {
    this.stopped = true
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([this.flush(), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) })])
    if (timer) clearTimeout(timer)
    if (this.pending.size) { this.drop('shutdown_timeout', this.pending.size); this.pending.clear(); this.bytes = 0 }
  }
}
