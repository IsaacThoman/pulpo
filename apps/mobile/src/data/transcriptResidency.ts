export const INACTIVE_TRANSCRIPT_COUNT = 5
export const INACTIVE_TRANSCRIPT_BYTES = 10 * 1024 * 1024

type Entry = { bytes: number; used: number; revision: number; expired: boolean; responseIds: Set<string> }
interface ResidencyOptions {
  protected: (id: string, responseIds: ReadonlySet<string>) => boolean
  settle: (id: string) => Promise<void>
  evict: (id: string, responseIds: ReadonlySet<string>) => void
  maxCount?: number
  maxBytes?: number
}

/** Coordinates all owners of an inactive transcript; no data is copied into this registry. */
export class TranscriptResidency {
  private entries = new Map<string, Entry>()
  private pins = new Map<string, number>()
  private active: string | null = null
  private clock = 0
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private dirty = false
  constructor(private options: ResidencyOptions) {}

  register(id: string, bytes: number, responseIds: Iterable<string>): void {
    if (this.disposed) return
    const previous = this.entries.get(id)
    this.entries.set(id, { bytes, used: previous?.used ?? ++this.clock, revision: (previous?.revision ?? 0) + 1,
      expired: false, responseIds: new Set(responseIds) })
    this.schedule()
  }
  updateBytes(id: string, bytes: number): void {
    const entry = this.entries.get(id)
    if (!entry || this.disposed) return
    entry.bytes = bytes
    entry.revision++
    this.schedule()
  }
  activate(id: string | null): void {
    this.active = id
    const entry = id ? this.entries.get(id) : undefined
    if (entry) entry.used = ++this.clock
    this.schedule()
  }
  pin(id: string): () => void {
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1)
    const entry = this.entries.get(id)
    if (entry) entry.used = ++this.clock
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.pins.get(id) ?? 1) - 1
      if (count) this.pins.set(id, count); else this.pins.delete(id)
      this.schedule()
    }
  }
  chatForResponse(id: string): string | undefined {
    for (const [chatId, entry] of this.entries) if (entry.responseIds.has(id)) return chatId
  }
  expire(id: string): void { const entry = this.entries.get(id); if (entry) entry.expired = true; this.schedule() }
  private protected(id: string, entry: Entry): boolean {
    return id === this.active || this.pins.has(id) || this.options.protected(id, entry.responseIds)
  }
  schedule(): void {
    if (this.disposed) return
    this.dirty = true
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.sweep() }, 0)
  }
  async sweep(): Promise<void> {
    if (this.running) return this.running
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.running = this.collect()
    try { await this.running } finally { this.running = undefined }
  }
  private async collect(): Promise<void> {
    while (this.dirty && !this.disposed) {
      this.dirty = false
      let count = 0; let bytes = 0
      const ordered = [...this.entries].sort((a, b) => b[1].used - a[1].used)
      for (const [id, entry] of ordered) {
        if (this.protected(id, entry)) continue
        const keep = !entry.expired && count < (this.options.maxCount ?? INACTIVE_TRANSCRIPT_COUNT)
          && bytes + entry.bytes <= (this.options.maxBytes ?? INACTIVE_TRANSCRIPT_BYTES)
        if (keep) { count++; bytes += entry.bytes; continue }
        const revision = entry.revision
        try { await this.options.settle(id) } catch { continue }
        if (this.disposed) return
        if (this.entries.get(id) !== entry || entry.revision !== revision || this.protected(id, entry)) continue
        this.entries.delete(id)
        this.options.evict(id, entry.responseIds)
      }
    }
  }
  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.entries.clear(); this.pins.clear()
  }
  get size(): number { return this.entries.size }
}

let owner: { namespace: string; residency: TranscriptResidency } | undefined
const writes = new Map<string, { pending: Set<Promise<void>>; failed: boolean }>()
const writeKey = (namespace: string, id: string, kind: string) => JSON.stringify([namespace, id, kind])
export function registerTranscriptResidency(namespace: string, residency: TranscriptResidency): () => void {
  owner?.residency.dispose()
  owner = { namespace, residency }
  return () => { residency.dispose(); if (owner?.residency === residency) owner = undefined }
}
export function resetTranscriptResidency(): void { owner?.residency.dispose(); owner = undefined; writes.clear() }
export function protectTranscript(namespace: string, id: string): () => void {
  return owner?.namespace === namespace ? owner.residency.pin(id) : () => {}
}
export function protectTranscriptRequest(path: string, method: string): () => void {
  if (!owner || method === 'GET') return () => {}
  const chat = /^\/api\/chats\/([^/?]+)/.exec(path)?.[1]
  const response = /^\/api\/(?:responses|messages)\/([^/?]+)/.exec(path)?.[1]
  const id = chat ?? (response ? owner.residency.chatForResponse(response.replace(/:input$/, '')) : undefined)
  return id ? owner.residency.pin(id) : () => {}
}
export function trackTranscriptWrite(namespace: string, id: string, kind: 'summary' | 'detail', promise: Promise<void>): void {
  const key = writeKey(namespace, id, kind)
  let state = writes.get(key)
  if (!state) { state = { pending: new Set(), failed: false }; writes.set(key, state) }
  const captured = state
  captured.pending.add(promise)
  const finish = (failed: boolean) => {
    captured.pending.delete(promise)
    captured.failed = failed
    if (!captured.pending.size && !failed && writes.get(key) === captured) writes.delete(key)
    if (owner?.namespace === namespace) owner.residency.schedule()
  }
  void promise.then(() => finish(false), () => finish(true))
}
export function transcriptWriteProtected(namespace: string, id: string): boolean {
  return ['summary', 'detail'].some((kind) => {
    const state = writes.get(writeKey(namespace, id, kind))
    return state && (state.failed || state.pending.size > 0)
  })
}
