import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'

export interface ComposerCheckpoint {
  snapshot: ComposerSnapshot
  shelfContent?: ComposerState
  pending: Partial<ComposerState>
  clearRevision?: number
  /** Identifies a draft write whose server acknowledgement may have been lost. */
  unacknowledgedMutationId?: string
  /** Legacy single receipt, migrated when loading older checkpoints. */
  submission?: { state: ComposerState; revision?: number }
  submissions?: Array<{ state: ComposerState; revision?: number }>
}
export interface ComposerTransport {
  read(draftId: string): Promise<ComposerAck>
  write(input: ComposerWrite): Promise<ComposerAck>
}
export interface ComposerPersistence {
  recoverShelfContent?(state: ComposerState): Promise<void>
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

/** Submission clears consume message content, while leaving composer controls intact. */
export function sameComposerContent(before: ComposerState, after: ComposerState): boolean {
  return before.content === after.content && equal(before.attachments.map((item) => item.id), after.attachments.map((item) => item.id))
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
          entry!.shelfContent = saved.shelfContent
          entry!.snapshot = saved.snapshot
          entry!.pending = saved.pending
          entry!.unacknowledgedMutationId = saved.unacknowledgedMutationId
          entry!.clearRevision = saved.clearRevision
          entry!.submissions = saved.submissions ?? (saved.submission ? [saved.submission] : [])
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
    return { shelfContent: entry.shelfContent, snapshot: entry.snapshot, pending: { ...entry.inflight, ...entry.pending }, unacknowledgedMutationId: entry.unacknowledgedMutationId, clearRevision: entry.clearRevision, submissions: entry.submissions }
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
        // An acknowledgement can disappear after the server commits our partial
        // draft. That exact mutation is safe to rebase; another writer still wins.
        const acceptedOwnWrite = entry.unacknowledgedMutationId
          && result.snapshot.mutationId === entry.unacknowledgedMutationId
          && result.snapshot.clearedRevision === entry.snapshot.clearedRevision
        if (!acceptedOwnWrite) {
          await this.recoverShelfContent(entry, result.snapshot)
          entry.pending = {}
        }
      }
      entry.unacknowledgedMutationId = undefined
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
      if (entry.shelfContent) { entry.ready = false; if (this.transport) void this.reconcile(entry); return }
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
    entry.unacknowledgedMutationId = input.mutationId
    this.notify(entry, false)
    const previous = entry.snapshot
    entry.writing = (async () => {
      try {
        const result = await this.transport!.write(input)
        if (generation !== this.generation) { entry.pending = { ...patch, ...entry.pending }; return }
        if (!result.ok) throw new Error(result.error)
        entry.unacknowledgedMutationId = undefined
        if (result.conflict) {
          if (result.snapshot.clearedRevision > previous.clearedRevision) {
            await this.recoverShelfContent(entry, result.snapshot)
            entry.pending = {}
          }
          else entry.pending = { ...patch, ...entry.pending }
        }
        if (!result.conflict && !Object.keys(entry.pending).length) entry.shelfContent = undefined
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
  /** Protect explicit shelf restores from the automatic draft conflict policy. */
  replaceShelfContent(draftId: string, state: ComposerState): void {
    const entry = this.entries.get(draftId)
    if (!entry) return
    entry.shelfContent = state
    this.edit(draftId, { content: state.content, attachments: state.attachments })
  }
  private async recoverShelfContent(entry: Entry, remote: ComposerSnapshot): Promise<void> {
    if (!entry.shelfContent) return
    const content = { ...entry.shelfContent, ...entry.inflight, ...entry.pending }
    if ((content.content.trim() || content.attachments.length) && !sameComposerContent(content, remote.state)) {
      await this.persistence.recoverShelfContent?.(content)
    }
    entry.shelfContent = undefined
  }
  canRestoreSubmission(draftId: string, submitted: ComposerState): boolean {
    const entry = this.entries.get(draftId)
    return !entry || sameComposerContent({ ...entry.snapshot.state, ...entry.inflight, ...entry.pending }, submitted)
  }
  async prepareSubmission(draftId: string, submitted: ComposerState): Promise<number | null> {
    const revision = await this.flush(draftId)
    const entry = this.entries.get(draftId)
    return revision !== null && entry && equal(entry.snapshot.state, submitted) ? revision : null
  }
  async completeSubmission(draftId: string, submitted: ComposerState, revision?: number): Promise<void> {
    const entry = this.entries.get(draftId)
    if (!entry) return
    entry.submissions = [...(entry.submissions ?? []), { state: submitted, revision }]
    this.notify(entry, false)
    await entry.saved
    await this.finishSubmission(entry)
  }
  private async finishSubmission(entry: Entry): Promise<void> {
    if (entry.finishing) { await entry.finishing; return this.finishSubmission(entry) }
    if (!entry.submissions?.length || !entry.ready || !this.transport) return
    entry.finishing = this.finishSubmissions(entry)
    try { await entry.finishing } finally { entry.finishing = undefined }
  }
  private async finishSubmissions(entry: Entry): Promise<void> {
    const submitted = entry.submissions
    if (!submitted?.length) return
    // Keep receipts durable until the matching draft is cleared or replaced.
    // A same-state write can advance its revision while the send is pending.
    // Bound retries if another client is continuously changing the revision;
    // the retained receipts will be checked again on reconnect.
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = await this.flush(entry.snapshot.draftId)
      if (revision === null) return
      const matching = submitted.some((receipt) => sameComposerContent(entry.snapshot.state, receipt.state))
      if (matching) {
        const result = await this.clear(entry.snapshot.draftId, revision)
        if (result === 'pending') return
        if (result === 'conflict') continue
      }
      entry.submissions = entry.submissions?.filter((receipt) => !submitted.includes(receipt))
      this.notify(entry, false)
      return
    }
  }

  async clear(draftId: string, revision: number): Promise<'cleared' | 'conflict' | 'pending'> {
    const entry = this.entries.get(draftId)
    if (!entry) return 'pending'
    entry.clearRevision = revision
    this.notify(entry, false)
    await entry.saved
    if (!this.transport || !entry.ready) return 'pending'
    const generation = this.generation
    try {
      const result = await this.transport.write({ draftId, baseRevision: revision, mutationId: `${this.clientId}:${++this.sequence}`, patch: {}, clear: true })
      if (generation !== this.generation) return 'pending'
      if (result.ok) {
        entry.clearRevision = undefined
        this.receive(result.snapshot, !result.conflict)
        this.notify(entry)
        return result.conflict ? 'conflict' : 'cleared'
      }
    } catch { /* A successful submission's conditional clear is durable and retried on reconnect. */ }
    return 'pending'
  }
}
interface Entry extends ComposerCheckpoint {
  listeners: Set<(checkpoint: ComposerCheckpoint) => void>
  loaded?: Promise<void>
  saved: Promise<void>
  inflight?: Partial<ComposerState>
  writing?: Promise<void>
  finishing?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  ready: boolean
  reconciling?: { generation: number; promise: Promise<void> }
}
