import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import {
  COMPUTER_INLINE_MAX_BYTES,
  COMPUTER_PUSH_MAX_FILE_BYTES,
  type ComputerFolderChange,
  type ComputerFolderChangeResult,
  type ComputerFolderEntry,
  type ComputerFolderMode,
  type ComputerParams,
  type ComputerResult,
} from '@pulpo/contracts'
import type { ChangesStore, StoredChange } from './changes'
import { versionIfFile } from './changes'
import { assertSessionActive, ComputerError } from './errors'
import type { ComputerAccount } from './grants'
import { realFolder, resolveForChange, resolveInFolder } from './paths'
import { createLineMatcher, isSkippedFolder, looksBinary, SEARCH_MAX_FILE_BYTES, SEARCH_MAX_FILES, SEARCH_TIME_BUDGET_MS } from './search'
import { downloadFile, temporarySibling, transferUrl, uploadFile, writeInline } from './transfers'

/**
 * `pulpo computer` in the cloud workspace reaches the session's folder through these. Nothing
 * here executes anything, and every path is confined to the folder (see paths.ts).
 *
 * While suggested files are pending, the agent sees the folder as if they were accepted: those
 * files' suggested contents stand in for the disk in listings, reads, searches, sends and
 * conflict checks, and folders they would create appear too.
 */

/** Longest text `folder.read` returns in one answer; it has to fit a socket message even when JSON escapes swell it. */
const READ_MAX_BYTES = 1024 * 1024
/** A listing that walks this long stops and says it is incomplete: the main process must stay responsive. */
const LIST_TIME_BUDGET_MS = 20_000

export interface FolderSession {
  sessionId: string
  access: ComputerFolderMode
  /** Absolute path the user granted. */
  folder: string
  account: ComputerAccount
  origin: string
  /** Whether this is still the registered session; checked before anything in the folder is changed. */
  active?: () => boolean
}

export interface FolderContext {
  changes: ChangesStore
  platform: NodeJS.Platform
  allowHttpLocalhost: boolean
  trash: (absolutePath: string) => Promise<void>
}

interface View {
  root: string
  pending: Map<string, StoredChange>
}

interface Node { name: string; relative: string; kind: 'file' | 'folder'; sizeBytes: number; modifiedAt: string; absolute?: string; pending?: StoredChange }

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

const childPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name)

export class FolderService {
  constructor(private readonly context: FolderContext) {}

  private async view(session: FolderSession): Promise<View> {
    return { root: await realFolder(session.folder), pending: await this.context.changes.pendingFiles(session.account, session.folder) }
  }

  private resolve(view: View, requested: string) { return resolveInFolder(view.root, requested, this.context.platform) }
  /** For anything about to be created, replaced, moved or removed. */
  private resolveChange(view: View, requested: string) { return resolveForChange(view.root, requested, this.context.platform) }

  /** Folders that exist only because a pending suggestion would create files in them. */
  private pendingFolders(view: View): Set<string> {
    const folders = new Set<string>()
    for (const relative of view.pending.keys()) {
      const segments = relative.split('/')
      for (let index = 1; index < segments.length; index += 1) folders.add(segments.slice(0, index).join('/'))
    }
    return folders
  }

  /** Direct children of a folder: what is on disk, with pending suggestions laid over it. */
  private async children(view: View, relative: string, absolute: string | undefined): Promise<Node[]> {
    const nodes = new Map<string, Node>()
    if (absolute) {
      let entries: import('node:fs').Dirent[] = []
      try { entries = await readdir(absolute, { withFileTypes: true }) } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'EACCES' && code !== 'EPERM') throw error
      }
      for (const entry of entries) {
        // Symlinks are never followed when walking, wherever they point.
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue
        const entryPath = path.join(absolute, entry.name)
        const metadata = await stat(entryPath).catch(() => null)
        if (!metadata) continue
        nodes.set(entry.name, {
          name: entry.name,
          relative: childPath(relative, entry.name),
          kind: entry.isDirectory() ? 'folder' : 'file',
          sizeBytes: entry.isDirectory() ? 0 : metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
          absolute: entryPath,
        })
      }
    }
    const prefix = relative ? `${relative}/` : ''
    for (const [pendingPath, change] of view.pending) {
      if (!pendingPath.startsWith(prefix)) continue
      const rest = pendingPath.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash < 0 ? rest : rest.slice(0, slash)
      const existing = nodes.get(name)
      if (slash < 0) {
        if (existing?.kind === 'folder') continue
        nodes.set(name, { name, relative: childPath(relative, name), kind: 'file', sizeBytes: change.sizeBytes ?? 0, modifiedAt: change.createdAt, pending: change })
      } else if (!existing) {
        nodes.set(name, { name, relative: childPath(relative, name), kind: 'folder', sizeBytes: 0, modifiedAt: change.createdAt })
      }
    }
    return sortByName([...nodes.values()])
  }

  /** The node at a path, on disk or pending. */
  private async node(view: View, requested: string): Promise<Node> {
    const target = await this.resolve(view, requested)
    const pending = view.pending.get(target.relative)
    const name = target.relative.slice(target.relative.lastIndexOf('/') + 1)
    if (pending) return { name, relative: target.relative, kind: 'file', sizeBytes: pending.sizeBytes ?? 0, modifiedAt: pending.createdAt, pending }
    if (target.exists) {
      const metadata = await stat(target.absolute)
      if (metadata.isDirectory()) return { name, relative: target.relative, kind: 'folder', sizeBytes: 0, modifiedAt: metadata.mtime.toISOString(), absolute: target.absolute }
      if (metadata.isFile()) return { name, relative: target.relative, kind: 'file', sizeBytes: metadata.size, modifiedAt: metadata.mtime.toISOString(), absolute: target.absolute }
      throw new ComputerError('not_found', `"${requested}" is not a regular file or folder.`)
    }
    if (this.pendingFolders(view).has(target.relative)) return { name, relative: target.relative, kind: 'folder', sizeBytes: 0, modifiedAt: new Date(0).toISOString() }
    throw new ComputerError('not_found', `"${requested}" does not exist in the folder.`)
  }

  async list(session: FolderSession, params: ComputerParams<'folder.list'>): Promise<ComputerResult<'folder.list'>> {
    const view = await this.view(session)
    const start = await this.node(view, params.path)
    const entry = ({ relative, kind, sizeBytes, modifiedAt }: Node): ComputerFolderEntry => ({ path: relative, kind, sizeBytes, modifiedAt })
    if (start.kind === 'file') return { entries: [entry(start)], truncated: false }
    const entries: ComputerFolderEntry[] = []
    const skipped: string[] = []
    let truncated = false
    const deadline = Date.now() + LIST_TIME_BUDGET_MS
    const visit = async (folder: Node, depth: number): Promise<void> => {
      for (const child of await this.children(view, folder.relative, folder.absolute)) {
        if (truncated) return
        if (Date.now() > deadline) { truncated = true; return }
        if (child.kind === 'folder' && params.depth > 1 && isSkippedFolder(child.name)) { skipped.push(child.relative); continue }
        if (child.kind === 'file' || !params.filesOnly) {
          if (entries.length >= params.limit) { truncated = true; return }
          entries.push(entry(child))
        }
        if (child.kind === 'folder' && depth < params.depth) await visit(child, depth + 1)
      }
    }
    await visit(start, 1)
    return { entries, truncated, ...(skipped.length ? { skipped } : {}) }
  }

  /** The bytes behind a file node: the pending suggestion's, or the disk's. */
  private source(session: FolderSession, node: Node): string {
    if (node.pending) return this.context.changes.blobPath(session.account, node.pending.id)
    if (!node.absolute) throw new ComputerError('not_found', `"${node.relative}" does not exist in the folder.`)
    return node.absolute
  }

  async read(session: FolderSession, params: ComputerParams<'folder.read'>): Promise<ComputerResult<'folder.read'>> {
    const view = await this.view(session)
    const node = await this.node(view, params.path)
    if (node.kind !== 'file') throw new ComputerError('not_text', `"${params.path}" is a folder, not a text file.`)
    const file = this.source(session, node)
    const handle = await open(file, 'r')
    try {
      const sizeBytes = (await handle.stat()).size
      const length = Math.min(sizeBytes, params.maxBytes, READ_MAX_BYTES)
      const bytes = Buffer.alloc(length)
      const { bytesRead } = await handle.read(bytes, 0, length, 0)
      const content = bytes.subarray(0, bytesRead)
      const truncated = bytesRead < sizeBytes
      if (content.includes(0)) throw new ComputerError('not_text', `"${params.path}" is not a UTF-8 text file.`)
      let text: string
      // A cut may split a character; streaming mode leaves the incomplete tail out instead of failing.
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(content, { stream: truncated }) } catch {
        throw new ComputerError('not_text', `"${params.path}" is not a UTF-8 text file.`)
      }
      return { text, sizeBytes, truncated }
    } finally { await handle.close() }
  }

  async search(session: FolderSession, params: ComputerParams<'folder.search'>): Promise<ComputerResult<'folder.search'>> {
    const view = await this.view(session)
    const start = await this.node(view, params.path)
    const match = createLineMatcher(params.pattern, { ignoreCase: params.ignoreCase, fixed: params.fixed })
    const matches: ComputerResult<'folder.search'>['matches'] = []
    let truncated = false
    let visited = 0
    // Matching runs on the main process, one file at a time: a slow pattern over a big folder must end.
    const deadline = Date.now() + SEARCH_TIME_BUDGET_MS
    const searchFile = async (node: Node) => {
      visited += 1
      let bytes: Buffer
      try {
        const file = this.source(session, node)
        if ((await stat(file)).size > SEARCH_MAX_FILE_BYTES) return
        bytes = await readFile(file)
      } catch { return }
      if (looksBinary(bytes)) return
      for (const found of match(bytes.toString('utf8'), params.limit - matches.length + 1)) {
        if (matches.length >= params.limit) { truncated = true; return }
        matches.push({ path: node.relative, line: found.line, text: found.text })
      }
    }
    const visit = async (folder: Node): Promise<void> => {
      for (const child of await this.children(view, folder.relative, folder.absolute)) {
        if (truncated) return
        if (visited >= SEARCH_MAX_FILES || Date.now() > deadline) { truncated = true; return }
        if (child.kind === 'folder') { if (!isSkippedFolder(child.name)) await visit(child) } else await searchFile(child)
      }
    }
    if (start.kind === 'file') await searchFile(start)
    else await visit(start)
    return { matches, truncated }
  }

  async send(session: FolderSession, params: ComputerParams<'folder.send'>): Promise<ComputerResult<'folder.send'>> {
    const view = await this.view(session)
    const node = await this.node(view, params.path)
    if (node.kind !== 'file') throw new ComputerError('invalid_request', `"${params.path}" is a folder; send its files one by one.`)
    const file = this.source(session, node)
    const sizeBytes = (await stat(file)).size
    if (sizeBytes > params.maxBytes) throw new ComputerError('too_large', `"${params.path}" has ${sizeBytes} bytes, more than the ${params.maxBytes} allowed.`)
    if (sizeBytes <= COMPUTER_INLINE_MAX_BYTES) {
      const bytes = await readFile(file)
      if (bytes.byteLength > params.maxBytes) throw new ComputerError('too_large', `"${params.path}" grew past the ${params.maxBytes} bytes allowed.`)
      return { sizeBytes: bytes.byteLength, version: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') }
    }
    const hash = createHash('sha256')
    await uploadFile(transferUrl(session.origin, params.transfer.url, this.context.allowHttpLocalhost), file, sizeBytes, (chunk) => hash.update(chunk))
    return { sizeBytes, version: hash.digest('hex') }
  }

  /** The version the agent sees for a path: a pending suggestion's, else the file's on disk. */
  private async currentVersion(view: View, relative: string, absolute: string, exists: boolean): Promise<string | null> {
    const pending = view.pending.get(relative)
    if (pending?.sha256) return pending.sha256
    return exists ? versionIfFile(absolute) : null
  }

  async change(session: FolderSession, params: ComputerParams<'folder.change'>): Promise<ComputerResult<'folder.change'>> {
    const change = params.change as ComputerFolderChange
    if (session.access === 'read') return { status: 'denied', message: 'This folder is read only: the user did not allow changes. Tell the user what you would change instead.' }
    const view = await this.view(session)
    const base = { sessionId: session.sessionId, responseId: params.responseId, folder: session.folder }
    const changes = this.context.changes
    if (change.kind === 'put') return this.put(session, view, change, base)
    if (change.kind === 'mkdir') {
      const target = await this.resolveChange(view, change.path)
      if (!target.relative) throw new ComputerError('invalid_request', 'The folder itself already exists.')
      if (target.exists) {
        if ((await stat(target.absolute)).isDirectory()) return { status: 'unchanged', message: `${target.relative} already exists.` }
        throw new ComputerError('failed', `${target.relative} exists and is a file.`)
      }
      if (session.access === 'suggest') {
        await changes.suggest(session.account, { ...base, path: target.relative, kind: 'mkdir' })
        return { status: 'suggested', message: `Suggested creating ${target.relative}/. The user will accept or reject it.` }
      }
      assertSessionActive(session.active)
      await mkdir(target.absolute, { recursive: change.parents === true })
      await changes.recordApplied(session.account, { ...base, path: target.relative, kind: 'mkdir' })
      return { status: 'created', message: '' }
    }
    if (change.kind === 'move') {
      const from = await this.resolveChange(view, change.from)
      const to = await this.resolveChange(view, change.to)
      if (!from.relative || !to.relative) throw new ComputerError('invalid_request', 'The folder itself cannot be moved.')
      if (!from.exists) throw new ComputerError('not_found', `"${change.from}" does not exist in the folder${view.pending.has(from.relative) ? ' yet: it is only a pending suggestion' : ''}.`)
      if (to.exists) return { status: 'conflict', message: `"${change.to}" already exists. Remove it first or choose another name.` }
      if (session.access === 'suggest') {
        await changes.suggest(session.account, { ...base, path: from.relative, kind: 'move', to: to.relative })
        return { status: 'suggested', message: `Suggested moving ${from.relative} to ${to.relative}. The user will accept or reject it.` }
      }
      assertSessionActive(session.active)
      await mkdir(path.dirname(to.absolute), { recursive: true })
      await rename(from.absolute, to.absolute)
      await changes.recordApplied(session.account, { ...base, path: from.relative, kind: 'move', to: to.relative })
      return { status: 'updated', message: `Moved ${from.relative} to ${to.relative}.` }
    }
    // remove
    const target = await this.resolveChange(view, change.path)
    if (!target.relative) throw new ComputerError('invalid_request', 'The folder itself cannot be removed.')
    if (!target.exists) throw new ComputerError('not_found', `"${change.path}" does not exist in the folder.`)
    const metadata = await stat(target.absolute)
    if (metadata.isDirectory() && !change.recursive && (await readdir(target.absolute)).length > 0) {
      throw new ComputerError('failed', `"${change.path}" is a folder that is not empty; remove it recursively.`)
    }
    if (session.access === 'suggest') {
      await changes.suggest(session.account, { ...base, path: target.relative, kind: 'remove', recursive: change.recursive === true })
      return { status: 'suggested', message: `Suggested removing ${target.relative}. The user will accept or reject it.` }
    }
    assertSessionActive(session.active)
    await this.context.trash(target.absolute)
    await changes.recordApplied(session.account, { ...base, path: target.relative, kind: 'remove' })
    return { status: 'updated', message: `Moved ${target.relative} to the trash.` }
  }

  private async put(session: FolderSession, view: View, change: Extract<ComputerFolderChange, { kind: 'put' }>, base: { sessionId: string; responseId: string; folder: string }): Promise<ComputerFolderChangeResult> {
    if (change.sizeBytes > COMPUTER_PUSH_MAX_FILE_BYTES) throw new ComputerError('too_large', `Files over ${COMPUTER_PUSH_MAX_FILE_BYTES / 1024 / 1024} MB cannot be saved to the computer.`)
    const target = await this.resolveChange(view, change.path)
    if (!target.relative) throw new ComputerError('invalid_request', 'A file path is required.')
    const existing = target.exists ? await stat(target.absolute) : null
    if (existing && !existing.isFile()) throw new ComputerError('failed', `"${change.path}" is a folder.`)
    const current = await this.currentVersion(view, target.relative, target.absolute, target.exists)
    const conflict = (version: string | null): ComputerFolderChangeResult => version === null
      ? { status: 'conflict', message: `"${target.relative}" no longer exists on the computer. Push with --force to create it again.` }
      : { status: 'conflict', message: `"${target.relative}" changed on the computer since you pulled it. Pull it again and redo your change, or push with --force to overwrite.`, version }
    if (!change.force && change.base !== current) {
      // A push repeated after its answer was lost finds its own bytes already there: that is no conflict.
      const repeated = await this.stage(session, change)
      try {
        if (repeated.sha256 === current) return { status: 'unchanged', message: '', version: repeated.sha256 }
      } finally { await repeated.dispose() }
      return conflict(current)
    }
    const diskVersion = existing ? await versionIfFile(target.absolute) : null
    const kind = target.exists ? 'update' : 'create'
    if (session.access === 'suggest') {
      const staged = await this.stage(session, change)
      try {
        if (staged.sha256 === current) return { status: 'unchanged', message: '', version: current }
        await this.context.changes.suggest(session.account, { ...base, path: target.relative, kind, sizeBytes: change.sizeBytes }, { source: staged.open(), sha256: staged.sha256, sizeBytes: change.sizeBytes, diskBase: diskVersion })
      } finally { await staged.dispose() }
      return { status: 'suggested', message: `Suggested ${kind === 'create' ? 'creating' : 'changing'} ${target.relative}. The user will accept or reject it; until then you see your version.`, version: staged.sha256 }
    }
    // Edit directly: write beside the target, verify, then rename into place.
    await mkdir(path.dirname(target.absolute), { recursive: true })
    const temporary = temporarySibling(target.absolute)
    const check = { sizeBytes: change.sizeBytes }
    let version: string
    try {
      version = change.data !== undefined
        ? await writeInline(change.data, temporary, check)
        : await downloadFile(transferUrl(session.origin, change.transfer!.url, this.context.allowHttpLocalhost), temporary, check)
      if (version === diskVersion && !view.pending.has(target.relative)) {
        await rm(temporary, { force: true })
        return { status: 'unchanged', message: '', version }
      }
      // The bytes took a while to arrive; a save the user made meanwhile must not be lost.
      const latest = await versionIfFile(target.absolute)
      if (!change.force && latest !== diskVersion) {
        await rm(temporary, { force: true })
        return conflict(latest)
      }
      // The new file takes the place of the old one, so it keeps its permissions (a script stays executable).
      if (existing) await chmod(temporary, existing.mode & 0o7777)
      // Nor is a file put in place for a reply that ended, or a folder taken back, while it arrived.
      assertSessionActive(session.active)
      await rename(temporary, target.absolute)
    } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error }
    await this.context.changes.recordApplied(session.account, { ...base, path: target.relative, kind: target.exists ? 'update' : 'create', sizeBytes: change.sizeBytes })
    return { status: target.exists ? 'updated' : 'created', message: '', version }
  }

  /** Brings a suggested file's bytes to a temporary file first, to learn their version before staging. */
  private async stage(session: FolderSession, change: Extract<ComputerFolderChange, { kind: 'put' }>): Promise<{ sha256: string; open: () => Readable; dispose: () => Promise<void> }> {
    if (change.data !== undefined) {
      const bytes = Buffer.from(change.data, 'base64')
      if (bytes.byteLength !== change.sizeBytes) throw new ComputerError('failed', `The file from Pulpo has ${bytes.byteLength} bytes, not the ${change.sizeBytes} announced.`)
      return { sha256: createHash('sha256').update(bytes).digest('hex'), open: () => Readable.from([bytes]), dispose: async () => undefined }
    }
    const temporary = `${this.context.changes.blobPath(session.account, 'incoming')}-${Math.random().toString(16).slice(2)}`
    const sha256 = await downloadFile(transferUrl(session.origin, change.transfer!.url, this.context.allowHttpLocalhost), temporary, { sizeBytes: change.sizeBytes })
    return { sha256, open: () => createReadStream(temporary), dispose: () => rm(temporary, { force: true }) }
  }
}

