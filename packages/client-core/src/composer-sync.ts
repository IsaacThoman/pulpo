import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'

export interface ComposerCheckpoint {
  snapshot: ComposerSnapshot
  pending: Partial<ComposerState>
  clearRevision?: number
  submission?: { state: ComposerState; revision?: number }
}
export interface ComposerTransport {
  read(draftId: string): Promise<ComposerAck>
  write(input: ComposerWrite): Promise<ComposerAck>
}
export interface ComposerPersistence {
  load(draftId: string): Promise<ComposerCheckpoint | null>
  save(draftId: string, checkpoint: ComposerCheckpoint): Promise<void>
}
// PostgreSQL jsonb does not preserve object key order. Array order remains significant.
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
}
export function composerPatch(before: ComposerState, after: ComposerState): Partial<ComposerState> {
  return Object.fromEntries((Object.keys(after) as (keyof ComposerState)[]).filter((key) => !equal(before[key], after[key])).map((key) => [key, after[key]]))
}

/** One account/instance per coordinator. A disconnected client never replays against a new revision. */
export class ComposerSync {
  private entries = new Map<string, Entry>()
  private transport: ComposerTransport | null = null
  private generation = 0
  private disposed = false
  private sequence = 0
  constructor(private persistence: ComposerPersistence, private clientId: string) {}

  async open(draftId: string, initial: ComposerState, listener: (checkpoint: ComposerCheckpoint) => void): Promise<() => void> {
    let entry = this.entries.get(draftId)
    if (!entry) {
      entry = { snapshot: { draftId, revision: 0, clearedRevision: 0, mutationId: null, state: emptyComposerState() }, pending: {}, listeners: new Set(), ready: false, saved: Promise.resolve() }
      this.entries.set(draftId, entry)
      entry.loaded = this.persistence.load(draftId).catch(() => null).then((saved) => {
        if (saved) {
          // Read supported fields only; old checkpoints may still contain retired recovery copies.
          entry!.snapshot = saved.snapshot
          entry!.pending = saved.pending
          entry!.clearRevision = saved.clearRevision
          entry!.submission = saved.submission
        }
        else if (initial.content || initial.attachments.length || initial.model) entry!.pending = { ...initial }
      })
    }
    await entry.loaded
    if (this.disposed) return () => undefined
    entry.listeners.add(listener)
    this.notify(entry)
    if (this.transport && !entry.ready) await this.reconcile(entry)
    return () => { entry!.listeners.delete(listener) }
  }

  connect(transport: ComposerTransport): void {
    this.transport = transport
    this.generation++
    for (const entry of this.entries.values()) { entry.ready = false; void this.reconcile(entry) }
  }
  disconnect(): void {
    this.transport = null
    this.generation++
    for (const entry of this.entries.values()) entry.ready = false
  }
  dispose(): void {
    this.disposed = true
    this.disconnect()
    for (const entry of this.entries.values()) { if (entry.timer) clearTimeout(entry.timer); entry.listeners.clear() }
    this.entries.clear()
  }
  private checkpoint(entry: Entry): ComposerCheckpoint {
    return { snapshot: entry.snapshot, pending: { ...entry.inflight, ...entry.pending }, clearRevision: entry.clearRevision, submission: entry.submission }
  }
  private notify(entry: Entry, publish = true): void {
    if (this.disposed) return
    const checkpoint = this.checkpoint(entry)
    // Serialize storage writes so a slow write cannot restore an earlier revision.
    entry.saved = entry.saved.catch(() => undefined).then(() => this.disposed ? undefined : this.persistence.save(entry.snapshot.draftId, checkpoint)).catch(() => undefined)
    if (publish) for (const listener of entry.listeners) listener(checkpoint)
  }
  private reconcile(entry: Entry): Promise<void> {
    if (entry.reconciling?.generation === this.generation) return entry.reconciling.promise
    const operation = { generation: this.generation, promise: this.reconcileEntry(entry) }
    entry.reconciling = operation
    void operation.promise.finally(() => { if (entry.reconciling === operation) entry.reconciling = undefined })
    return operation.promise
  }
  private async reconcileEntry(entry: Entry): Promise<void> {
    const generation = this.generation
    await entry.loaded
    await entry.writing
    try {
      const result = await this.transport?.read(entry.snapshot.draftId)
      if (generation !== this.generation || !result?.ok) return
      if (result.snapshot.revision !== entry.snapshot.revision && Object.keys(entry.pending).length) {
        entry.pending = {}
      }
      if (result.snapshot.revision >= entry.snapshot.revision) entry.snapshot = result.snapshot
      entry.ready = true
      if (entry.clearRevision !== undefined) await this.clear(entry.snapshot.draftId, entry.clearRevision)
      this.notify(entry)
      await this.flush(entry.snapshot.draftId)
      await this.finishSubmission(entry)
    } catch { /* Preserve pending writes until reconnect. */ }
  }
  receive(snapshot: ComposerSnapshot, preservePending = false): void {
    const entry = this.entries.get(snapshot.draftId)
    if (!entry) return
    if (!entry.ready) { if (this.transport) void this.reconcile(entry); return }
    if (snapshot.revision <= entry.snapshot.revision) return
    if (!preservePending && snapshot.clearedRevision > entry.snapshot.clearedRevision && Object.keys(entry.pending).length) {
      entry.pending = {}
    }
    entry.snapshot = snapshot
    this.notify(entry)
  }
  attachToInactiveDraft(draftId: string, attachment: ComposerState['attachments'][number]): void {
    const entry = this.entries.get(draftId)
    if (!entry || entry.listeners.size > 0) return
    const current = entry.pending.attachments ?? entry.snapshot.state.attachments
    if (!current.some((item) => item.id === attachment.id)) this.edit(draftId, { attachments: [...current, attachment] })
  }
  edit(draftId: string, patch: Partial<ComposerState>): void {
    const entry = this.entries.get(draftId)
    if (!entry || !Object.keys(patch).length) return
    entry.pending = { ...entry.pending, ...patch }
    this.notify(entry)
    if (Object.keys(patch).some((key) => key !== 'content')) { void this.flush(draftId); return }
    // Throttle with a trailing flush, rather than waiting for typing to stop.
    if (!entry.timer) entry.timer = setTimeout(() => { entry.timer = undefined; void this.flush(draftId) }, 150)
  }
  async flush(draftId: string): Promise<number | null> {
    const entry = this.entries.get(draftId)
    if (!entry || !entry.ready || !this.transport) return null
    if (entry.writing) { await entry.writing; return this.flush(draftId) }
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    if (!Object.keys(entry.pending).length) return entry.snapshot.revision
    const generation = this.generation
    const patch = entry.pending
    entry.inflight = patch
    entry.pending = {}
    const input: ComposerWrite = { draftId, patch, baseRevision: entry.snapshot.revision, mutationId: `${this.clientId}:${++this.sequence}` }
    const previous = entry.snapshot
    entry.writing = (async () => {
      try {
        const result = await this.transport!.write(input)
        if (generation !== this.generation) { entry.pending = { ...patch, ...entry.pending }; return }
        if (!result.ok) throw new Error(result.error)
        if (result.conflict) {
          if (result.snapshot.clearedRevision > previous.clearedRevision) {
            entry.pending = {}
          }
          else entry.pending = { ...patch, ...entry.pending }
        }
        if (result.snapshot.revision >= entry.snapshot.revision) entry.snapshot = result.snapshot
      } catch {
        entry.pending = { ...patch, ...entry.pending }
        entry.ready = false
      } finally { entry.inflight = undefined; this.notify(entry) }
    })()
    await entry.writing
    entry.writing = undefined
    return entry.ready ? this.flush(draftId) : null
  }
  canRestoreSubmission(draftId: string, submitted: ComposerState): boolean {
    const entry = this.entries.get(draftId)
    return !entry || equal({ ...entry.snapshot.state, ...entry.inflight, ...entry.pending }, submitted)
  }
  async prepareSubmission(draftId: string, submitted: ComposerState): Promise<number | null> {
    const revision = await this.flush(draftId)
    const entry = this.entries.get(draftId)
    return revision !== null && entry && equal(entry.snapshot.state, submitted) ? revision : null
  }
  async completeSubmission(draftId: string, submitted: ComposerState, revision?: number): Promise<void> {
    const entry = this.entries.get(draftId)
    if (!entry) return
    entry.submission = { state: submitted, revision }
    this.notify(entry, false)
    await entry.saved
    await this.finishSubmission(entry)
  }
  private async finishSubmission(entry: Entry): Promise<void> {
    if (!entry.submission || !entry.ready || !this.transport) return
    const submitted = entry.submission
    const revision = await this.flush(entry.snapshot.draftId)
    if (revision === null) return
    entry.submission = undefined
    this.notify(entry, false)
    if (equal(entry.snapshot.state, submitted.state)) await this.clear(entry.snapshot.draftId, submitted.revision ?? revision)
  }

  async clear(draftId: string, revision: number): Promise<void> {
    const entry = this.entries.get(draftId)
    if (!entry) return
    entry.clearRevision = revision
    this.notify(entry, false)
    await entry.saved
    if (!this.transport || !entry.ready) return
    try {
      const result = await this.transport.write({ draftId, baseRevision: revision, mutationId: `${this.clientId}:${++this.sequence}`, patch: {}, clear: true })
      if (result.ok) {
        entry.clearRevision = undefined
        this.receive(result.snapshot, !result.conflict)
        this.notify(entry)
      }
    } catch { /* A successful submission's conditional clear is durable and retried on reconnect. */ }
  }
}
interface Entry extends ComposerCheckpoint {
  listeners: Set<(checkpoint: ComposerCheckpoint) => void>
  loaded?: Promise<void>
  saved: Promise<void>
  inflight?: Partial<ComposerState>
  writing?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  ready: boolean
  reconciling?: { generation: number; promise: Promise<void> }
}
