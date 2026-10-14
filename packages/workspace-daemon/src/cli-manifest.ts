import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { UsageError } from './cli-args.js'

/** What the CLI last pulled or pushed for a local file. The server never trusts any of it. */
export interface ManifestEntry { remote: string; nodeId: string; version: string; sha256: string }
/** A local copy whose item was moved (`to`) or trashed (`to: null`) in Files; a plain push must not recreate it. */
export interface Tombstone { remote: string; to: string | null }
export interface Manifest { version: 1; files: Record<string, ManifestEntry>; moved: Record<string, Tombstone> }

export interface LocalFile { local: string; remote: string; sha256: string; entry?: ManifestEntry }
export interface DetachedFile { local: string; remote: string; to: string | null }
export interface LocalStatus { modified: LocalFile[]; added: LocalFile[]; deleted: Array<{ local: string; remote: string }>; detached: DetachedFile[] }
export interface PushItem { local: string; remote: string; base: { nodeId: string; version: string } | null; force?: true; sha256: string }
export interface PushPlan { items: PushItem[]; refused: Array<{ local: string; remote: string; message: string }> }

const LOCK_WAIT_MS = 60_000
const LOCK_STALE_MS = 300_000
// Daemons before hidden upload names staged pulls as `<name>.<uuid>.upload` next to the target.
const LEGACY_UPLOAD = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.upload$/

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isEntry = (value: unknown): value is ManifestEntry => isRecord(value) && ['remote', 'nodeId', 'version', 'sha256'].every((key) => typeof value[key] === 'string')
const isTombstone = (value: unknown): value is Tombstone => isRecord(value) && typeof value.remote === 'string' && (value.to === null || typeof value.to === 'string')

export async function readManifest(path: string): Promise<Manifest> {
  const manifest: Manifest = { version: 1, files: {}, moved: {} }
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return manifest
    throw error
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error(`${path} is not valid JSON. Delete it and pull the items again.`) }
  const { files, moved } = isRecord(parsed) ? parsed : {}
  if (isRecord(files)) for (const [local, entry] of Object.entries(files)) if (isEntry(entry)) manifest.files[local] = entry
  if (isRecord(moved)) for (const [local, tombstone] of Object.entries(moved)) if (isTombstone(tombstone)) manifest.moved[local] = tombstone
  return manifest
}

/** A lock file owned by a process that died (killed with its bash command) or that is absurdly old. */
async function staleLock(lock: string): Promise<boolean> {
  try {
    const [owner, metadata] = await Promise.all([readFile(lock, 'utf8'), stat(lock)])
    if (Date.now() - metadata.mtimeMs > LOCK_STALE_MS) return true
    const pid = Number(owner)
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
  } catch { return false }
}

/** Serializes manifest read-modify-write across `pulpo files` processes (background jobs, parallel commands). */
async function lockManifest(path: string): Promise<() => Promise<void>> {
  const lock = `${path}.lock`
  await mkdir(dirname(path), { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await writeFile(lock, String(process.pid), { flag: 'wx' })
      return () => rm(lock, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (await staleLock(lock)) { await rm(lock, { force: true }); continue }
    if (Date.now() > deadline) throw new Error(`another pulpo files command is still updating ${path}. Try again, or delete ${lock} if none is running.`)
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30))
  }
}

export async function updateManifest(path: string, change: (manifest: Manifest) => void | Promise<void>): Promise<void> {
  const unlock = await lockManifest(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const manifest = await readManifest(path)
    await change(manifest)
    for (const local of Object.keys(manifest.moved)) {
      if (manifest.files[local] || !await stat(local).catch(() => undefined)) delete manifest.moved[local]
    }
    const { moved, ...rest } = manifest
    await writeFile(temporary, `${JSON.stringify(Object.keys(moved).length ? manifest : rest, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await unlock()
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function isInside(path: string, root: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}

export const sameRemote = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** Accepts Files paths in the forms models type: "/Projects", "./Projects/", or a mirror path. */
export function remotePath(value: string, mirrorRoot: string): string {
  if (isAbsolute(value) && isInside(resolve(value), mirrorRoot)) return relative(mirrorRoot, resolve(value)).split(sep).join('/')
  const path = value.replace(/^(?:\.?\/)+/, '').replace(/\/+$/, '')
  return path === '.' ? '' : path
}

/** Regular files below a directory, skipping dot-names (editor droppings, uploads in progress) and symlinks. */
export async function* walkFiles(directory: string): AsyncGenerator<string> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || LEGACY_UPLOAD.test(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(path)
    else if (entry.isFile()) yield path
  }
}

const mirrorRemote = (local: string, mirrorRoot: string) => relative(mirrorRoot, local).split(sep).join('/')

/** Local-only comparison against the manifest; nothing here asks Pulpo. */
export async function localStatus(mirrorRoot: string, manifest: Manifest): Promise<LocalStatus> {
  const status: LocalStatus = { modified: [], added: [], deleted: [], detached: [] }
  const seen = new Set<string>()
  for await (const local of walkFiles(mirrorRoot)) {
    seen.add(local)
    const entry = manifest.files[local]; const tombstone = manifest.moved[local]
    if (!entry && tombstone) { status.detached.push({ local, remote: tombstone.remote, to: tombstone.to }); continue }
    const sha256 = await sha256File(local)
    if (!entry) status.added.push({ local, remote: mirrorRemote(local, mirrorRoot), sha256 })
    else if (entry.sha256 !== sha256) status.modified.push({ local, remote: entry.remote, sha256, entry })
  }
  for (const [local, entry] of Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right))) {
    if (seen.has(local)) continue
    const metadata = await stat(local).catch(() => undefined)
    if (!metadata) { status.deleted.push({ local, remote: entry.remote }); continue }
    if (!metadata.isFile()) continue
    const sha256 = await sha256File(local)
    if (entry.sha256 !== sha256) status.modified.push({ local, remote: entry.remote, sha256, entry })
  }
  return status
}

export function detachedMessage({ remote, to }: { remote: string; to: string | null }): string {
  return to === null
    ? `${remote} was moved to the trash in Files. Push this copy with --to <path> to create it again, or delete it.`
    : `${remote} was moved in Files (to "${to}"). Pull it from its new path, or push this copy with --to <path>.`
}

/**
 * Chooses what `push` sends. Without paths: every modified or new file. Named files always go
 * (the server reports "unchanged"); named directories contribute only modified and new files.
 * Copies of items moved or trashed in Files are refused unless --to says where they belong.
 */
export async function planPush(input: { mirrorRoot: string; manifest: Manifest; locals: string[]; to?: string; force: boolean }): Promise<PushPlan> {
  const { mirrorRoot, manifest, force } = input
  let candidates: Array<{ local: string; sha256: string; explicit: boolean }> = []
  const refused: PushPlan['refused'] = []
  if (!input.locals.length) {
    if (input.to !== undefined) throw new UsageError('--to needs exactly one local file.', 'push')
    const status = await localStatus(mirrorRoot, manifest)
    candidates = [...status.modified, ...status.added].map(({ local, sha256 }) => ({ local, sha256, explicit: false }))
    refused.push(...status.detached.map((file) => ({ local: file.local, remote: file.remote, message: detachedMessage(file) })))
  } else {
    const seen = new Set<string>()
    const add = async (local: string, explicit: boolean) => {
      if (seen.has(local)) return
      seen.add(local)
      const tombstone = manifest.files[local] ? undefined : manifest.moved[local]
      if (tombstone && input.to === undefined) { refused.push({ local, remote: tombstone.remote, message: detachedMessage(tombstone) }); return }
      const sha256 = await sha256File(local)
      if (explicit || manifest.files[local]?.sha256 !== sha256) candidates.push({ local, sha256, explicit })
    }
    for (const local of input.locals) {
      const metadata = await stat(local).catch(() => undefined)
      if (!metadata) throw new Error(`${local} does not exist.`)
      if (metadata.isDirectory()) {
        if (input.to !== undefined) throw new UsageError('--to needs exactly one local file, not a directory.', 'push')
        for await (const file of walkFiles(local)) await add(file, false)
      } else if (metadata.isFile()) await add(local, true)
      else throw new Error(`${local} is not a regular file.`)
    }
    if (input.to !== undefined && candidates.length !== 1) throw new UsageError('--to needs exactly one local file.', 'push')
  }
  const items = candidates.map(({ local, sha256 }) => {
    const entry = manifest.files[local]
    let remote: string
    if (input.to !== undefined) {
      const target = remotePath(input.to, mirrorRoot)
      remote = input.to.endsWith('/') ? [target, basename(local)].filter(Boolean).join('/') : target
      if (!remote) throw new UsageError('--to needs a Files path.', 'push')
    } else if (entry) remote = entry.remote
    else if (isInside(local, mirrorRoot) && local !== mirrorRoot) remote = mirrorRemote(local, mirrorRoot)
    else throw new UsageError(`${local} is outside ${mirrorRoot} and was not pulled, so its place in Files is unknown. Add --to <path>.`, 'push')
    const base = !force && entry && sameRemote(entry.remote, remote) ? { nodeId: entry.nodeId, version: entry.version } : null
    return { local, remote, base, ...(force ? { force: true as const } : {}), sha256 }
  })
  return { items, refused }
}

/** Removes empty parent directories of deleted mirror files, stopping at the mirror root. */
export async function pruneEmptyDirectories(files: string[], mirrorRoot: string): Promise<void> {
  for (const file of files) {
    let directory = dirname(file)
    while (directory !== mirrorRoot && isInside(directory, mirrorRoot)) {
      try { await rmdir(directory) } catch { break }
      directory = dirname(directory)
    }
  }
}
