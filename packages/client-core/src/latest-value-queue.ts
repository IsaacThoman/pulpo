/** Serialize writes per key and retain only the newest value queued behind an active request. */
export class LatestValueQueue<Key, Value, Result> {
  private readonly entries = new Map<Key, QueueEntry<Value, Result>>()

  enqueue(key: Key, value: Value, write: (value: Value) => Promise<Result>): Promise<Result> {
    const active = this.entries.get(key)
    if (active) {
      active.next = { value, write }
      return active.drain
    }

    const entry: QueueEntry<Value, Result> = {
      next: { value, write },
      drain: Promise.resolve(undefined as Result),
    }
    this.entries.set(key, entry)
    entry.drain = this.drain(key, entry)
    return entry.drain
  }

  private async drain(key: Key, entry: QueueEntry<Value, Result>): Promise<Result> {
    let result!: Result
    let failure: unknown
    try {
      while (entry.next) {
        const current = entry.next
        entry.next = undefined
        try {
          result = await current.write(current.value)
          failure = undefined
        } catch (error) {
          failure = error
        }
      }
      if (failure !== undefined) throw failure
      return result
    } finally {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
  }
}

interface QueueEntry<Value, Result> {
  next?: { value: Value; write: (value: Value) => Promise<Result> }
  drain: Promise<Result>
}
