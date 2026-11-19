import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { ComputerChange, ComputerChangeDetail } from '@pulpo/contracts'
import { accountDirectoryName, type ComputerAccount } from './grants'
import { realFolder, resolveForChange, resolveInFolder } from './paths'
import { temporarySibling, writeVerified } from './transfers'

/**
 * Changes the agent made or suggested in a folder, kept on this computer only: metadata in
 * `<root>/<account>/changes.json`, suggested file contents in `<root>/<account>/blobs/<id>`.
 * Suggestions wait here until the user accepts (applied then, with a conflict check) or rejects.
 */

const DETAIL_TEXT_MAX_BYTES = 1024 * 1024
const DECIDED_RETENTION_MS = 30 * 24 * 60 * 60_000
/**
 * A suggestion nobody decided in this long is rejected. Until then the agent sees it as accepted,
 * and that view must not drift from the disk forever.
 */
const PENDING_EXPIRY_MS = 30 * 24 * 60 * 60_000

export interface StoredChange extends ComputerChange {
  /** Hex SHA-256 of a suggested file's contents. */
  sha256?: string
  /** The version on disk the suggestion was made against (null: no file), for the accept-time conflict check. */
  diskBase?: string | null
  /** A suggested removal: whether it takes a folder's contents with it. Without it, a folder must still be empty when accepted. */
  recursive?: boolean
  decidedAt?: string
}

interface ChangesFile { version: 1; changes: StoredChange[] }

export interface ChangesStoreOptions {
  root: string
  onChanged: () => void
  /** Whether the folder is still one the account allowed; checked again when a suggestion is accepted. */
  folderGranted: (account: ComputerAccount, folder: string) => Promise<boolean>
  trash: (absolutePath: string) => Promise<void>
  platform?: NodeJS.Platform
  now?: () => number
}

export async function fileVersion(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** A file's version, or null when there is no regular file there. */
export async function versionIfFile(file: string): Promise<string | null> {
  const metadata = await stat(file).catch(() => null)
  return metadata?.isFile() ? fileVersion(file) : null
}

async function textForReview(file: string): Promise<{ text: string | null; binary: boolean }> {
  const metadata = await stat(file).catch(() => null)
  if (!metadata?.isFile()) return { text: null, binary: false }
  if (metadata.size > DETAIL_TEXT_MAX_BYTES) return { text: null, binary: true }
  const bytes = await readFile(file)
  if (bytes.includes(0)) return { text: null, binary: true }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), binary: false } } catch { return { text: null, binary: true } }
}

function publicChange(change: StoredChange): ComputerChange {
  const { sha256: _sha256, diskBase: _diskBase, recursive: _recursive, decidedAt: _decidedAt, ...rest } = change
  return rest
}

const undecided = (change: StoredChange) => change.status === 'pending' || change.status === 'conflict'
const carriesFile = (change: StoredChange) => change.kind === 'create' || change.kind === 'update'

export interface NewChange {
  sessionId: string
  responseId: string
  folder: string
  path: string
  kind: ComputerChange['kind']
  to?: string
  sizeBytes?: number
  /** For a suggested removal: see `StoredChange.recursive`. */
  recursive?: boolean
}

export class ChangesStore {
  private readonly cache = new Map<string, ChangesFile>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => number

  constructor(private readonly options: ChangesStoreOptions) { this.now = options.now ?? Date.now }

  private directory(account: ComputerAccount): string { return path.join(this.options.root, accountDirectoryName(account)) }
  blobPath(account: ComputerAccount, id: string): string { return path.join(this.directory(account), 'blobs', id) }

  private async load(account: ComputerAccount): Promise<ChangesFile> {
    const directory = this.directory(account)
    const cached = this.cache.get(directory)
    if (cached) return cached
    let changes: StoredChange[] = []
    try {
      const parsed = JSON.parse(await readFile(path.join(directory, 'changes.json'), 'utf8')) as Partial<ChangesFile>
      if (parsed.version === 1 && Array.isArray(parsed.changes)) changes = parsed.changes.filter((change) => change && typeof change.id === 'string' && /^[0-9a-f-]{36}$/.test(change.id))
    } catch { changes = [] }
    const file: ChangesFile = { version: 1, changes }
    this.cache.set(directory, file)
    return file
  }

  private async save(account: ComputerAccount, file: ChangesFile): Promise<void> {
    const directory = this.directory(account)
    await mkdir(directory, { recursive: true })
    const target = path.join(directory, 'changes.json')
    await writeFile(`${target}.tmp`, `${JSON.stringify(file)}\n`, { mode: 0o600 })
    await rename(`${target}.tmp`, target)
  }

  /** Runs one read-modify-write at a time, and tells the renderer afterwards when `notify` says so. */
  private exclusive<T>(work: () => Promise<T>, notify: (result: T) => boolean = () => true): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next.then((result) => { if (notify(result)) this.options.onChanged(); return result })
  }

  async list(account: ComputerAccount, filter: { sessionIds?: string[]; folder?: string } = {}): Promise<ComputerChange[]> {
    await this.queue
    const sessions = filter.sessionIds ? new Set(filter.sessionIds) : null
    return (await this.load(account)).changes
      .filter((change) => (!sessions || sessions.has(change.sessionId)) && (filter.folder === undefined || change.folder === filter.folder))
      .map(publicChange)
  }

  /** Pending suggested files of a folder by path: what the agent sees in place of the disk. */
  async pendingFiles(account: ComputerAccount, folder: string): Promise<Map<string, StoredChange>> {
    await this.queue
    const result = new Map<string, StoredChange>()
    for (const change of (await this.load(account)).changes) {
      if (change.status === 'pending' && carriesFile(change) && change.folder === folder) result.set(change.path, change)
    }
    return result
  }

  async detail(account: ComputerAccount, id: string): Promise<ComputerChangeDetail | null> {
    await this.queue
    const change = (await this.load(account)).changes.find((candidate) => candidate.id === id)
    if (!change) return null
    let before: { text: string | null; binary: boolean } = { text: null, binary: false }
    let after: { text: string | null; binary: boolean } = { text: null, binary: false }
    if (carriesFile(change)) {
      try {
        const target = await resolveInFolder(await realFolder(change.folder), change.path, this.options.platform)
        if (change.kind === 'update' || target.exists) before = await textForReview(target.absolute)
      } catch { /* the folder or file is gone: nothing to show before */ }
      after = await textForReview(this.blobPath(account, change.id))
    }
    return { ...publicChange(change), before: before.text, after: after.text, binary: before.binary || after.binary }
  }

  /** Records a change applied right away (Edit directly). */
  recordApplied(account: ComputerAccount, change: NewChange): Promise<ComputerChange> {
    return this.exclusive(async () => {
      const file = await this.load(account)
      const now = new Date(this.now()).toISOString()
      const record: StoredChange = { id: randomUUID(), ...change, status: 'applied', createdAt: now, decidedAt: now }
      // A file the agent wrote directly supersedes any suggestion for it still waiting.
      if (carriesFile(record)) await this.dropPending(account, file, record.folder, record.path)
      file.changes.push(record)
      await this.save(account, file)
      return publicChange(record)
    })
  }

  /**
   * Stages a suggestion. A suggested file's bytes come from `source` and are verified against
   * `sizeBytes`/`sha256`; a newer suggestion for the same file replaces the pending one but keeps
   * the disk version that one was made against.
   */
  suggest(account: ComputerAccount, change: NewChange, contents?: { source: Readable; sha256: string; sizeBytes: number; diskBase: string | null }): Promise<ComputerChange> {
    return this.exclusive(async () => {
      const file = await this.load(account)
      const id = randomUUID()
      const record: StoredChange = { id, ...change, status: 'pending', createdAt: new Date(this.now()).toISOString() }
      if (contents) {
        await writeVerified(contents.source, this.blobPath(account, id), { sizeBytes: contents.sizeBytes, sha256: contents.sha256 })
        const replaced = file.changes.find((candidate) => candidate.status === 'pending' && carriesFile(candidate) && candidate.folder === change.folder && candidate.path === change.path)
        record.sha256 = contents.sha256
        record.diskBase = replaced ? replaced.diskBase ?? null : contents.diskBase
        if (replaced) record.kind = replaced.kind
        await this.dropPending(account, file, change.folder, change.path)
      }
      file.changes.push(record)
      await this.save(account, file)
      return publicChange(record)
    })
  }

  private async dropPending(account: ComputerAccount, file: ChangesFile, folder: string, relative: string): Promise<void> {
    const dropped = file.changes.filter((change) => change.status === 'pending' && carriesFile(change) && change.folder === folder && change.path === relative)
    if (!dropped.length) return
    file.changes = file.changes.filter((change) => !dropped.includes(change))
    for (const change of dropped) await rm(this.blobPath(account, change.id), { force: true })
  }

  reject(account: ComputerAccount, ids: string[]): Promise<ComputerChange[]> {
    return this.exclusive(async () => {
      const file = await this.load(account)
      const wanted = new Set(ids)
      const decided: StoredChange[] = []
      for (const change of file.changes) {
        if (!wanted.has(change.id) || !undecided(change)) continue
        change.status = 'rejected'
        change.decidedAt = new Date(this.now()).toISOString()
        await rm(this.blobPath(account, change.id), { force: true })
        decided.push(change)
      }
      if (decided.length) await this.save(account, file)
      return decided.map(publicChange)
    }, (decided) => decided.length > 0)
  }

  /**
   * Applies pending suggestions. A file that changed on disk since the suggestion (or a move whose
   * target now exists) becomes a `conflict` unless `overwrite`. Every target is resolved again
   * inside its folder, and the folder must still be allowed.
   */
  accept(account: ComputerAccount, ids: string[], options: { overwrite?: boolean } = {}): Promise<ComputerChange[]> {
    return this.exclusive(async () => {
      const file = await this.load(account)
      const wanted = new Set(ids)
      const targets = file.changes.filter((change) => wanted.has(change.id) && undecided(change))
      for (const folder of new Set(targets.map((change) => change.folder))) {
        if (!await this.options.folderGranted(account, folder)) throw new Error(`Pulpo is no longer allowed to use ${folder}. Choose the folder again to accept these changes.`)
      }
      const failures: string[] = []
      for (const change of targets) {
        try {
          change.status = await this.apply(account, change, options.overwrite === true)
          change.decidedAt = new Date(this.now()).toISOString()
          if (change.status === 'accepted') await rm(this.blobPath(account, change.id), { force: true })
        } catch (error) {
          failures.push(`${change.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await this.save(account, file)
      if (failures.length) {
        this.options.onChanged()
        throw new Error(`Some changes could not be applied. ${failures.join('; ')}`)
      }
      return targets.map(publicChange)
    })
  }

  private async apply(account: ComputerAccount, change: StoredChange, overwrite: boolean): Promise<'accepted' | 'conflict'> {
    const root = await realFolder(change.folder)
    // The same rules as when the change was suggested: the folder may have changed since.
    const target = await resolveForChange(root, change.path, this.options.platform)
    if (carriesFile(change)) {
      const existing = target.exists ? await stat(target.absolute) : null
      const current = existing ? await versionIfFile(target.absolute) : null
      if (existing && current === null) throw new Error('A folder is in the way')
      if (!overwrite && current !== (change.diskBase ?? null) && current !== change.sha256) return 'conflict'
      await mkdir(path.dirname(target.absolute), { recursive: true })
      const temporary = temporarySibling(target.absolute)
      try {
        await copyFile(this.blobPath(account, change.id), temporary)
        // Copying took a while; a save the user made meanwhile must not be lost.
        if (!overwrite && await versionIfFile(target.absolute) !== current) {
          await rm(temporary, { force: true })
          return 'conflict'
        }
        // The new file takes the place of the old one, so it keeps its permissions.
        if (existing) await chmod(temporary, existing.mode & 0o7777)
        await rename(temporary, target.absolute)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
      return 'accepted'
    }
    if (change.kind === 'mkdir') { await mkdir(target.absolute, { recursive: true }); return 'accepted' }
    if (change.kind === 'remove') {
      if (!target.exists) return 'accepted'
      // Suggested as an empty folder: what was put in it since was never part of the suggestion.
      if (!overwrite && change.recursive === false && (await stat(target.absolute)).isDirectory() && (await readdir(target.absolute)).length > 0) return 'conflict'
      await this.options.trash(target.absolute)
      return 'accepted'
    }
    // move
    if (!target.exists || change.to === undefined) return 'conflict'
    const destination = await resolveForChange(root, change.to, this.options.platform)
    if (destination.exists && !overwrite) return 'conflict'
    await mkdir(path.dirname(destination.absolute), { recursive: true })
    await rename(target.absolute, destination.absolute)
    return 'accepted'
  }

  /** Rejects suggestions left undecided for 30 days and forgets decided changes older than that, for every account on this computer. */
  async prune(): Promise<void> {
    const cutoff = this.now() - DECIDED_RETENTION_MS
    const expiry = this.now() - PENDING_EXPIRY_MS
    const directories = await readdir(this.options.root).catch(() => [] as string[])
    await this.exclusive(async () => {
      let removed = 0
      for (const name of directories) {
        if (!/^[0-9a-f]{32}$/.test(name)) continue
        const directory = path.join(this.options.root, name)
        const fileName = path.join(directory, 'changes.json')
        let file: ChangesFile
        try { file = JSON.parse(await readFile(fileName, 'utf8')) as ChangesFile } catch { continue }
        if (!Array.isArray(file.changes)) continue
        const expired = file.changes.filter((change) => undecided(change) && Date.parse(change.createdAt) < expiry)
        for (const change of expired) {
          change.status = 'rejected'
          change.decidedAt = new Date(this.now()).toISOString()
          await rm(path.join(directory, 'blobs', change.id), { force: true })
        }
        const stale = file.changes.filter((change) => !undecided(change) && !expired.includes(change) && Date.parse(change.decidedAt ?? change.createdAt) < cutoff)
        if (!stale.length && !expired.length) continue
        for (const change of stale) await rm(path.join(directory, 'blobs', change.id), { force: true })
        file.changes = file.changes.filter((change) => !stale.includes(change))
        await writeFile(`${fileName}.tmp`, `${JSON.stringify(file)}\n`, { mode: 0o600 })
        await rename(`${fileName}.tmp`, fileName)
        this.cache.delete(directory)
        removed += stale.length + expired.length
      }
      return removed
    }, (removed) => removed > 0)
  }
}
