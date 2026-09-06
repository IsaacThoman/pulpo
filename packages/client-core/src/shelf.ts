import { emptyComposerState, type ComposerState } from '@pulpo/contracts'
import type { ComposerCheckpoint } from './composer-sync.js'
import type { ShelvedDraft, ShelfMutation, ShelfSnapshot } from '@pulpo/contracts'

export interface ShelfAttachment {
  localId: string
  id?: string
  name: string
  mimeType: string
  size: number
  /** Platform-owned durable Blob (web) or file URI (native). */
  source?: unknown
}
export interface LocalShelvedDraft {
  id: string
  content: string
  attachments: ShelfAttachment[]
  status?: 'pending' | 'uploading' | 'failed'
  error?: string
}
type LocalAction =
  | { type: 'save'; draft: LocalShelvedDraft }
  | { type: 'restore'; id: string; replacement?: LocalShelvedDraft }
  | { type: 'delete'; id: string }
  | { type: 'reorder'; id: string; targetId: string; edge: 'before' | 'after' }
export interface ShelfOperation { operationId: string; action: LocalAction; error?: string; removed?: ShelfAttachment[] }
export interface ShelfCheckpoint { snapshot: ShelfSnapshot; operations: ShelfOperation[]; files?: Record<string, ShelfAttachment> }
export interface ShelfHandoff { isCurrent?: () => boolean; before: { content: string; attachments: ShelfAttachment[] }; after: { content: string; attachments: ShelfAttachment[] } }
export interface ShelfPorts {
  load(): Promise<ShelfCheckpoint | null>
  save(checkpoint: ShelfCheckpoint, handoff?: ShelfHandoff): Promise<void>
  /** Must serialize read/modify/write across instances, including browser tabs. */
  replayLock?<T>(work: () => Promise<T>): Promise<T>
  lock<T>(work: () => Promise<T>): Promise<T>
  read(): Promise<ShelfSnapshot>
  mutate(input: ShelfMutation): Promise<ShelfSnapshot>
  release?(attachments: ShelfAttachment[]): Promise<void>
  upload(attachment: ShelfAttachment): Promise<string>
  uuid(): string
}
export const emptyShelf = (): ShelfCheckpoint => ({ snapshot: { revision: 0, drafts: [] }, operations: [] })
export function localShelfDraft(draft: ShelvedDraft): LocalShelvedDraft {
  return { id: draft.id, content: draft.content, attachments: draft.attachments.map((a) => ({ ...a, localId: a.id })) }
}
export function applyShelfAction(items: LocalShelvedDraft[], action: LocalAction): LocalShelvedDraft[] {
  const next = [...items]
  if (action.type === 'save') {
    if (!next.some((item) => item.id === action.draft.id)) next.unshift(action.draft)
  } else if (action.type === 'restore') {
    const index = next.findIndex((item) => item.id === action.id)
    if (index >= 0) next.splice(index, 1, ...(action.replacement ? [action.replacement] : []))
    else if (action.replacement && !next.some((item) => item.id === action.replacement!.id)) next.unshift(action.replacement)
  } else if (action.type === 'delete') return next.filter((item) => item.id !== action.id)
  else if (action.id !== action.targetId) {
    const item = next.find((row) => row.id === action.id)
    if (!item || !next.some((row) => row.id === action.targetId)) return next
    next.splice(next.indexOf(item), 1)
    next.splice(next.findIndex((row) => row.id === action.targetId) + (action.edge === 'after' ? 1 : 0), 0, item)
  }
  return next
}
export function shelfView(checkpoint: ShelfCheckpoint): LocalShelvedDraft[] {
  return checkpoint.operations.reduce((items, op) => {
    const draft = op.action.type === 'save' ? op.action.draft : op.action.type === 'restore' ? op.action.replacement : undefined
    const action = draft ? { ...op.action, [op.action.type === 'save' ? 'draft' : 'replacement']: {
      ...draft, status: op.error ? 'failed' : 'pending', error: op.error,
    } } as LocalAction : op.action
    return applyShelfAction(items, action)
  }, checkpoint.snapshot.drafts.map((row) => {
    const draft = localShelfDraft(row)
    draft.attachments = draft.attachments.map((a) => ({ ...checkpoint.files?.[a.id!], ...a, source: checkpoint.files?.[a.id!]?.source }))
    return draft
  }))
}

/** Explicit saves are durable operations, independent of automatic composer sync. */
export class ShelfSync {
  private checkpoint = emptyShelf()
  private listeners = new Set<() => void>()
  private running?: Promise<void>
  private uploadingDraftId?: string
  private stopped = false
  private retryTimer?: ReturnType<typeof setTimeout>
  private refreshAgain = false
  private rows: LocalShelvedDraft[] = []
  constructor(private ports: ShelfPorts) {}
  getSnapshot = (): LocalShelvedDraft[] => this.rows
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(checkpoint: ShelfCheckpoint): void {
    if (this.stopped) return
    this.checkpoint = checkpoint
    this.rows = shelfView(checkpoint).map((row) => row.id === this.uploadingDraftId && !row.error ? { ...row, status: 'uploading' } : row)
    for (const listener of this.listeners) listener()
  }
  async hydrate(): Promise<void> { await this.ports.lock(async () => this.publish(await this.ports.load() ?? emptyShelf())) }
  private async change(work: (state: ShelfCheckpoint) => ShelfHandoff | void): Promise<void> {
    await this.ports.lock(async () => {
      if (this.stopped) throw new Error('Shelf session ended')
      const state = await this.ports.load() ?? emptyShelf()
      const handoff = work(state)
      if (handoff?.isCurrent && !handoff.isCurrent()) throw new Error('The composer changed. Please try again.')
      await this.ports.save(state, handoff || undefined)
      this.publish(state)
    })
  }
  private async append(action: LocalAction): Promise<void> {
    await this.change((state) => { state.operations.push({ operationId: this.ports.uuid(), action }) })
    void this.sync()
  }
  async saveCopy(content: string, attachments: ShelfAttachment[]): Promise<void> {
    await this.append({ type: 'save', draft: { id: this.ports.uuid(), content, attachments } })
  }
  async shelve(content: string, attachments: ShelfAttachment[], isCurrent?: () => boolean): Promise<string> {
    if (!content.trim() && !attachments.length) throw new Error('Add text or an attachment before shelving')
    const id = this.ports.uuid()
    await this.change((state) => {
      state.operations.push({ operationId: this.ports.uuid(), action: { type: 'save', draft: { id, content, attachments } } })
      return { isCurrent, before: { content, attachments }, after: { content: '', attachments: [] } }
    })
    void this.sync()
    return id
  }
  async restore(id: string, current: { content: string; attachments: ShelfAttachment[] }, isCurrent?: () => boolean): Promise<LocalShelvedDraft> {
    let restored: LocalShelvedDraft | undefined
    await this.change((state) => {
      restored = shelfView(state).find((row) => row.id === id)
      if (!restored) throw new Error('This draft was already restored or deleted')
      const replacement = current.content.trim() || current.attachments.length
        ? { id: this.ports.uuid(), ...current } : undefined
      // A failed pending save can be consumed without successfully uploading it.
      for (const op of state.operations) if (operationDraft(op)?.id === id) delete op.error
      state.operations.push({ operationId: this.ports.uuid(), action: { type: 'restore', id, replacement } })
      return { isCurrent, before: current, after: restored }
    })
    void this.sync()
    return restored!
  }
  async delete(id: string): Promise<void> {
    await this.change((state) => {
      for (const op of state.operations) if (operationDraft(op)?.id === id) delete op.error
      state.operations.push({ operationId: this.ports.uuid(), action: { type: 'delete', id }, removed: shelfView(state).find((row) => row.id === id)?.attachments })
    })
    void this.sync()
  }
  reorder(id: string, targetId: string, edge: 'before' | 'after'): Promise<void> { return this.append({ type: 'reorder', id, targetId, edge }) }
  async retry(): Promise<void> {
    await this.change((state) => { for (const op of state.operations) delete op.error })
    void this.sync()
  }
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) { this.refreshAgain = true; return this.running }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    const work = (this.ports.replayLock ? this.ports.replayLock(() => this.run()) : this.run()).catch(() => undefined).finally(() => {
      this.running = undefined
      if (this.refreshAgain && !this.stopped) { this.refreshAgain = false; void this.sync() }
    })
    this.running = work
    return work
  }
  private retryLater(): void {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.sync() }, 15_000)
    ;(this.retryTimer as unknown as { unref?: () => void }).unref?.()
  }
  private async run(): Promise<void> {
    try {
      const remote = await this.ports.read()
      await this.change((state) => { if (remote.revision >= state.snapshot.revision) state.snapshot = remote })
    } catch { this.retryLater(); return }
    while (!this.stopped) {
      await this.hydrate()
      const op = this.checkpoint.operations[0]
      if (!op || op.error) return
      try {
        let action = op.action
        let draft = action.type === 'save' ? action.draft : action.type === 'restore' ? action.replacement : undefined
        // A locally consumed save need not finish an obsolete upload. The later
        // consume still runs, even if a previous save acknowledgement was lost.
        if (draft && this.checkpoint.operations.slice(1).some((later) =>
          (later.action.type === 'delete' || later.action.type === 'restore') && later.action.id === draft!.id)) {
          action = action.type === 'save' ? { type: 'delete', id: draft.id } : { type: 'restore', id: (action as { id: string }).id }
          draft = undefined
        }
        if (draft) {
          for (const attachment of draft.attachments) {
            if (attachment.id) continue
            if (!attachment.source) throw new Error(`The local file “${attachment.name}” is unavailable. Restore the draft to replace it.`)
            if (this.stopped) return
            this.uploadingDraftId = draft.id
            this.publish(this.checkpoint)
            const id = await this.ports.upload(attachment)
            await this.change((state) => {
              // Persist upload results before sending; retries reuse the ready file.
              for (const pending of state.operations) {
                const d = pending.action.type === 'save' ? pending.action.draft : pending.action.type === 'restore' ? pending.action.replacement : undefined
                for (const a of [...(d?.attachments ?? []), ...(pending.removed ?? [])]) if (a.localId === attachment.localId) a.id = id
              }
            })
            attachment.id = id
          }
        }
        this.uploadingDraftId = undefined
        const wireDraft = draft ? { id: draft.id, content: draft.content, attachmentIds: draft.attachments.map((a) => a.id!) } : undefined
        const wire: ShelfMutation['action'] = action.type === 'save' ? { type: 'save', draft: wireDraft! }
          : action.type === 'restore' ? { type: 'restore', id: action.id, replacement: wireDraft } : action
        if (this.stopped) return
        const remote = await this.ports.mutate({ operationId: op.operationId, action: wire })
        await this.change((state) => {
          if (remote.revision >= state.snapshot.revision) state.snapshot = remote
          state.files ??= {}
          for (const a of draft?.attachments ?? []) if (a.id && a.source) state.files[a.id] = a
          state.operations = state.operations.filter((item) => item.operationId !== op.operationId)
          const remaining = new Set(shelfView(state).flatMap((row) => row.attachments.map((a) => a.id)))
          for (const a of op.removed ?? []) if (a.id && !remaining.has(a.id)) delete state.files[a.id]
        })
        if (op.removed) {
          const used = new Set(this.rows.flatMap((row) => row.attachments.map((a) => a.id ?? a.localId)))
          await this.ports.release?.(op.removed.filter((a) => !used.has(a.id ?? a.localId))).catch(() => undefined)
        }
      } catch (error) {
        this.uploadingDraftId = undefined
        this.publish(this.checkpoint)
        const status = (error as { status?: number }).status
        // Connectivity errors remain pending and retry on reconnect. Permanent
        // failures and upload errors stay recoverable instead of dropping data.
        if (status && status < 500 && status !== 408 && status !== 429 || !status && error instanceof Error && !/fetch|network|offline|connection/i.test(error.message)) {
          await this.change((state) => {
            const pending = state.operations.find((item) => item.operationId === op.operationId)
            if (pending) pending.error = error instanceof Error ? error.message : 'Could not save draft'
          }).catch(() => undefined)
        }
        this.retryLater()
        return
      }
    }
  }
  dispose(): void { this.stopped = true; if (this.retryTimer) clearTimeout(this.retryTimer); this.listeners.clear() }
}

function operationDraft(op: ShelfOperation): LocalShelvedDraft | undefined { return op.action.type === "save" ? op.action.draft : op.action.type === "restore" ? op.action.replacement : undefined }

/** Written in the same local transaction as the shelf and composer draft. */
export function shelfComposerCheckpoint(saved: ComposerCheckpoint | null, handoff: ShelfHandoff): ComposerCheckpoint {
  const checkpoint = saved ?? { snapshot: { draftId: 'new', state: emptyComposerState(), revision: 0, clearedRevision: 0, mutationId: null }, pending: {} }
  const controls = { ...checkpoint.snapshot.state, ...checkpoint.pending }
  const state = (draft: ShelfHandoff['after']): ComposerState => ({ ...controls, content: draft.content,
    attachments: draft.attachments.filter((a) => a.id).map((a) => ({ id: a.id!, name: a.name, mimeType: a.mimeType, size: a.size })) })
  const after = state(handoff.after)
  return { ...checkpoint, pending: { ...checkpoint.pending, content: after.content, attachments: after.attachments },
    shelfContent: after,
    submissions: [...(checkpoint.submissions ?? []), { state: state(handoff.before) }],
  }
}
