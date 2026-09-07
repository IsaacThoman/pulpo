import type { ImportedFile } from '../../../modules/pulpo-file-import'
import { createOperationQueue } from '../../data/operationQueue'

export interface IncomingFile {
  id: string
  source: string
  namespace: string | null
  file?: ImportedFile
  error?: string
}

/** Owns files until a hydrated composer durably accepts them. */
export class IncomingFileQueue {
  private items: IncomingFile[] = []
  private listeners = new Set<() => void>()
  private identity: string | null | undefined
  private validNamespaces?: ReadonlySet<string>
  private loading?: Promise<void>
  private write = createOperationQueue()

  constructor(private deps: {
    uuid: () => string
    load: () => Promise<IncomingFile[]>
    save: (items: IncomingFile[]) => Promise<void>
    copy: (source: string) => Promise<ImportedFile>
    release: (file: ImportedFile) => void
  }) {}

  getSnapshot = () => this.items
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish() { for (const listener of this.listeners) listener() }
  private persist() {
    // Read at execution time: a slower disk write must not resurrect consumed entries.
    return this.write(() => this.deps.save(this.items.filter((item) => item.file || item.error)))
  }
  hydrate() {
    this.loading ??= this.deps.load().then((items) => {
      this.items = items
      this.reconcileIdentity()
      this.publish()
    }).catch((error) => {
      this.loading = undefined
      throw error
    })
    return this.loading
  }
  private reconcileIdentity() {
    const identity = this.identity
    if (identity === undefined) return
    this.items = this.items.flatMap((item) => {
      // Switching profiles suspends delivery; changing accounts releases private files.
      if (item.namespace && (item.namespace.split('|profile:')[0] !== identity?.split('|profile:')[0]
        || (this.validNamespaces && !this.validNamespaces.has(item.namespace)))) {
        if (item.file) this.deps.release(item.file)
        return []
      }
      return [{ ...item, namespace: item.namespace ?? identity }]
    })
  }
  async setIdentity(namespace: string | null | undefined, validNamespaces?: ReadonlySet<string>) {
    this.identity = namespace
    this.validNamespaces = validNamespaces
    this.reconcileIdentity()
    this.publish()
    await this.hydrate()
    this.reconcileIdentity()
    this.publish()
    await this.persist()
  }
  async enqueue(source: string) {
    await this.hydrate()
    if (this.items.some((item) => item.source === source)) return
    const id = this.deps.uuid()
    this.items = [...this.items, { id, source, namespace: this.identity ?? null }]
    this.publish()
    let file: ImportedFile | undefined
    let error: string | undefined
    try { file = await this.deps.copy(source) }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The file could not be imported.' }
    if (!this.items.some((item) => item.id === id)) {
      if (file) this.deps.release(file)
      return
    }
    this.items = this.items.map((item) => item.id === id ? { ...item, file, error } : item)
    try { await this.persist() }
    catch (cause) {
      this.items = this.items.filter((item) => item.id !== id)
      if (file) this.deps.release(file)
      this.publish()
      throw cause
    }
    this.publish()
  }
  /** Call only after saving the destination draft. Rejected files are released. */
  async finish(id: string, accepted: boolean) {
    const item = this.items.find((candidate) => candidate.id === id)
    this.items = this.items.filter((candidate) => candidate.id !== id)
    await this.persist()
    if (!accepted && item?.file) this.deps.release(item.file)
    this.publish()
  }
}
