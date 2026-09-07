import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'

export interface ComposerCheckpoint {
  snapshot: ComposerSnapshot
  shelfContent?: ComposerState
  pending: Partial<ComposerState>
  clearRevision?: number
  /** Content-free receipt for moving the shared draft into this client's temporary composer. */
  temporaryTake?: { revision: number; mutationId?: string }
  /** Explicit return wins reconciliation after preserving displaced shared content. */
  temporaryReturn?: { preservedRevision?: number }
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
  recoverShelfContent?(state: ComposerState, source?: 'remote'): Promise<void>
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
/** Temporary drafts use a separate local slot and never enter the sync protocol. */
export function localComposerDraftId(chatId: string | null | undefined, temporary: boolean): string {
  return `${temporary ? 'temporary:' : ''}${chatId ?? 'new'}`
}

function sharedPatch(patch: Partial<ComposerState>): Partial<ComposerState> {
  const { temporary: _temporary, ...shared } = patch
  return shared
}

export function composerPatch(before: ComposerState, after: ComposerState): Partial<ComposerState> {
  return Object.fromEntries((Object.keys(after) as (keyof ComposerState)[]).filter((key) => key !== 'temporary' && !equal(before[key], after[key])).map((key) => [key, after[key]]))
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
    if (initial.temporary || draftId.startsWith('temporary:')) return () => undefined
    let entry = this.entries.get(draftId)
    if (!entry) {
      entry = { snapshot: { draftId, revision: 0, clearedRevision: 0, mutationId: null, state: emptyComposerState() }, pending: {}, listeners: new Set(), ready: false, saved: Promise.resolve() }
      this.entries.set(draftId, entry)
      entry.loaded = this.persistence.load(draftId).catch(() => null).then((saved) => {
        if (saved && !saved.snapshot.state.temporary && !saved.pending.temporary) {
          // Read supported fields only; old checkpoints may still contain retired recovery copies.
          entry!.shelfContent = saved.shelfContent?.temporary ? undefined : saved.shelfContent
          entry!.snapshot = saved.snapshot
          entry!.pending = sharedPatch(saved.pending)
          entry!.unacknowledgedMutationId = saved.unacknowledgedMutationId
          entry!.clearRevision = saved.clearRevision
          entry!.temporaryTake = saved.temporaryTake
          entry!.temporaryReturn = saved.temporaryReturn
          entry!.submissions = (saved.submissions ?? (saved.submission ? [saved.submission] : [])).filter((receipt) => !receipt.state.temporary)
        }
        else if (!saved && (initial.content || initial.attachments.length || initial.model)) entry!.pending = sharedPatch(initial)
        entry!.initialized = true
      })
    }
    const editGeneration = entry.editGeneration
    await entry.loaded
    if (this.disposed) return () => undefined
    if (entry.editGeneration === editGeneration) entry.detached = false
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
    const checkpoint: ComposerCheckpoint = { shelfContent: entry.shelfContent, snapshot: entry.snapshot, pending: { ...entry.inflight, ...entry.pending }, unacknowledgedMutationId: entry.unacknowledgedMutationId, clearRevision: entry.clearRevision, submissions: entry.submissions, temporaryTake: entry.temporaryTake, temporaryReturn: entry.temporaryReturn }
    if (entry.detached) {
      checkpoint.snapshot = { ...entry.snapshot, state: { ...entry.snapshot.state, content: '', attachments: [] } }
      checkpoint.pending = {}
      checkpoint.shelfContent = undefined
      checkpoint.submissions = undefined
    }
    return checkpoint
  }
  private notify(entry: Entry, publish = true): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const checkpoint = this.checkpoint(entry)
    // Serialize storage writes so a slow write cannot restore an earlier revision.
    const saved = entry.saved.then(() => this.disposed ? undefined : this.persistence.save(entry.snapshot.draftId, checkpoint))
    // Background saves remain best effort; explicit handoffs await the result.
    entry.saved = saved.catch(() => undefined)
    if (publish) for (const listener of entry.listeners) listener(checkpoint)
    return saved
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
    if (entry.handoffStaging) return
    try {
      const result = await this.transport?.read(entry.snapshot.draftId)
      if (generation !== this.generation || entry.handoffStaging || !result?.ok || result.snapshot.state.temporary) return
      const take = entry.temporaryTake
      if (take) {
        entry.snapshot = result.snapshot
        entry.ready = true
        if (result.snapshot.revision === take.revision || (take.mutationId && result.snapshot.mutationId === take.mutationId)) {
          const outcome = await this.clear(entry.snapshot.draftId, result.snapshot.revision)
          if (entry.temporaryTake !== take) return this.reconcileEntry(entry)
          if (outcome === 'pending') return
        }
        entry.temporaryTake = undefined
        entry.clearRevision = undefined
        entry.unacknowledgedMutationId = undefined
        this.notify(entry)
        await this.flush(entry.snapshot.draftId)
        return
      }
      const editGeneration = entry.editGeneration
      if (entry.temporaryReturn) await this.preserveDisplacedDraft(entry, result.snapshot)
      if (editGeneration !== entry.editGeneration) return this.reconcileEntry(entry)
      if (!entry.temporaryReturn && result.snapshot.revision !== entry.snapshot.revision && Object.keys(entry.pending).length) {
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
    if (snapshot.state.temporary) return
    const entry = this.entries.get(snapshot.draftId)
    if (!entry) return
    if (!entry.ready) { if (this.transport) void this.reconcile(entry); return }
    if (snapshot.revision <= entry.snapshot.revision) return
    if (entry.temporaryTake || entry.temporaryReturn) {
      entry.ready = false
      if (this.transport) void this.reconcile(entry)
      return
    }
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
    if (patch.temporary) return
    patch = sharedPatch(patch)
    const entry = this.entries.get(draftId)
    if (!entry || entry.detached || !Object.keys(patch).length) return
    entry.pending = { ...entry.pending, ...patch }
    this.notify(entry)
    if (Object.keys(patch).some((key) => key !== 'content')) { void this.flush(draftId); return }
    // Throttle with a trailing flush, rather than waiting for typing to stop.
    if (!entry.timer) entry.timer = setTimeout(() => { entry.timer = undefined; void this.flush(draftId) }, 150)
  }
  async flush(draftId: string): Promise<number | null> {
    const entry = this.entries.get(draftId)
    if (!entry || entry.detached || entry.temporaryTake || !entry.ready || !this.transport) return null
    if (entry.writing) { await entry.writing; return this.flush(draftId) }
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    if (!Object.keys(entry.pending).length) return entry.snapshot.revision
    const generation = this.generation
    const editGeneration = entry.editGeneration
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
        if (editGeneration !== entry.editGeneration) return
        if (generation !== this.generation) { entry.pending = { ...patch, ...entry.pending }; return }
        if (!result.ok) throw new Error(result.error)
        if (result.snapshot.state.temporary) throw new Error('temporary_composer_disabled')
        entry.unacknowledgedMutationId = undefined
        if (result.conflict) {
          if (entry.temporaryReturn) {
            await this.preserveDisplacedDraft(entry, result.snapshot)
            if (editGeneration !== entry.editGeneration) return
            entry.pending = { ...patch, ...entry.pending }
          }
          else if (result.snapshot.clearedRevision > previous.clearedRevision) {
            await this.recoverShelfContent(entry, result.snapshot)
            entry.pending = {}
          }
          else entry.pending = { ...patch, ...entry.pending }
        }
        if (!result.conflict && !Object.keys(entry.pending).length) {
          entry.shelfContent = undefined
          entry.temporaryReturn = undefined
        }
        if (result.snapshot.revision >= entry.snapshot.revision) entry.snapshot = result.snapshot
      } catch {
        if (editGeneration !== entry.editGeneration) return
        entry.pending = { ...patch, ...entry.pending }
        entry.ready = false
      } finally { entry.inflight = undefined; this.notify(entry) }
    })()
    await entry.writing
    entry.writing = undefined
    return entry.ready ? this.flush(draftId) : null
  }
  /** Detach immediately; only a revision/mutation receipt survives on disk. */
  async takeTemporary(draftId: string, moveLocal?: () => Promise<void>): Promise<void> {
    const entry = this.entries.get(draftId)
    if (!entry) { await moveLocal?.(); return }
    const captured = entry.initialized ? { revision: entry.snapshot.revision, mutationId: entry.unacknowledgedMutationId } : null
    entry.detached = true
    entry.handoffStaging = true
    entry.editGeneration = (entry.editGeneration ?? 0) + 1
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    await entry.loaded
    const previous = { pending: { ...entry.inflight, ...entry.pending }, temporaryReturn: entry.temporaryReturn, shelfContent: entry.shelfContent, submissions: entry.submissions, clearRevision: entry.clearRevision }
    entry.temporaryTake = captured ?? { revision: entry.snapshot.revision, mutationId: entry.unacknowledgedMutationId }
    entry.temporaryReturn = undefined
    entry.pending = {}
    entry.shelfContent = undefined
    entry.submissions = undefined
    entry.clearRevision = undefined
    try {
      await moveLocal?.()
      await this.notify(entry, false)
    } catch (error) {
      entry.detached = false
      entry.temporaryTake = undefined
      Object.assign(entry, previous)
      this.notify(entry, false)
      throw error
    } finally { entry.handoffStaging = false }
    entry.ready = false
    if (this.transport) void this.reconcile(entry)
  }

  /** Stage a normal draft before subscribing, so hydration cannot replace it. */
  async returnFromTemporary(draftId: string, state: ComposerState): Promise<void> {
    if (!this.entries.has(draftId)) {
      const close = await this.open(draftId, emptyComposerState(), () => {})
      close()
    }
    const entry = this.entries.get(draftId)!
    await entry.loaded
    const previous = { detached: entry.detached, temporaryTake: entry.temporaryTake, pending: entry.pending }
    entry.editGeneration = (entry.editGeneration ?? 0) + 1
    entry.detached = false
    entry.temporaryTake = undefined
    entry.clearRevision = undefined
    entry.temporaryReturn = {}
    entry.pending = sharedPatch({ ...state, temporary: false })
    entry.ready = false
    try { await this.notify(entry, false) }
    catch (error) {
      Object.assign(entry, previous)
      entry.temporaryReturn = undefined
      this.notify(entry, false)
      throw error
    }
    if (this.transport) void this.reconcile(entry)
  }

  private async preserveDisplacedDraft(entry: Entry, remote: ComposerSnapshot): Promise<void> {
    const returning = entry.temporaryReturn
    if (!returning || returning.preservedRevision === remote.revision) return
    const local = { ...entry.snapshot.state, ...entry.inflight, ...entry.pending }
    if ((remote.state.content.trim() || remote.state.attachments.length) && !sameComposerContent(local, remote.state)) {
      if (!this.persistence.recoverShelfContent) throw new Error('Draft shelf is unavailable')
      await this.persistence.recoverShelfContent(remote.state, 'remote')
    }
    if (entry.temporaryReturn !== returning) return
    entry.temporaryReturn = { preservedRevision: remote.revision }
    await this.notify(entry, false)
  }

  /** Protect explicit shelf restores from the automatic draft conflict policy. */
  replaceShelfContent(draftId: string, state: ComposerState): void {
    if (state.temporary) return
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
    if (submitted.temporary) return null
    const revision = await this.flush(draftId)
    const entry = this.entries.get(draftId)
    return revision !== null && entry && equal(entry.snapshot.state, submitted) ? revision : null
  }
  async completeSubmission(draftId: string, submitted: ComposerState, revision?: number): Promise<void> {
    if (submitted.temporary) return
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
    const editGeneration = entry.editGeneration
    if (!submitted?.length) return
    // Keep receipts durable until the matching draft is cleared or replaced.
    // A same-state write can advance its revision while the send is pending.
    // Bound retries if another client is continuously changing the revision;
    // the retained receipts will be checked again on reconnect.
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = await this.flush(entry.snapshot.draftId)
      if (revision === null || editGeneration !== entry.editGeneration) return
      const matching = submitted.some((receipt) => sameComposerContent(entry.snapshot.state, receipt.state))
      if (matching) {
        const result = await this.clear(entry.snapshot.draftId, revision)
        if (result === 'pending' || editGeneration !== entry.editGeneration) return
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
    const take = entry.temporaryTake
    try {
      const result = await this.transport.write({ draftId, baseRevision: revision, mutationId: `${this.clientId}:${++this.sequence}`, patch: {}, clear: true })
      if (generation !== this.generation) return 'pending'
      if (result.ok && !result.snapshot.state.temporary) {
        entry.clearRevision = undefined
        if (take && entry.temporaryTake === take) entry.snapshot = result.snapshot
        else this.receive(result.snapshot, !result.conflict)
        this.notify(entry)
        return result.conflict ? 'conflict' : 'cleared'
      }
    } catch { /* A successful submission's conditional clear is durable and retried on reconnect. */ }
    return 'pending'
  }
}
interface Entry extends ComposerCheckpoint {
  initialized?: boolean
  handoffStaging?: boolean
  detached?: boolean
  editGeneration?: number
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
