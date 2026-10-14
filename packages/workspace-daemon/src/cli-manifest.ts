import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { UsageError } from './cli-args.js'

/** What the CLI last pulled or pushed for a local file. The server never trusts any of it. */
export interface ManifestEntry { remote: string; nodeId: string; version: string; sha256: string }
export interface Manifest { version: 1; files: Record<string, ManifestEntry> }

export interface LocalFile { local: string; remote: string; sha256: string; entry?: ManifestEntry }
export interface LocalStatus { modified: LocalFile[]; added: LocalFile[]; deleted: Array<{ local: string; remote: string }> }
export interface PushItem { local: string; remote: string; base: { nodeId: string; version: string } | null; force?: true; sha256: string }

const isEntry = (value: unknown): value is ManifestEntry => Boolean(value) && typeof value === 'object'
  && ['remote', 'nodeId', 'version', 'sha256'].every((key) => typeof (value as Record<string, unknown>)[key] === 'string')

export async function readManifest(path: string): Promise<Manifest> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, files: {} }
    throw error
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error(`${path} is not valid JSON. Delete it and pull the items again.`) }
  const files = (parsed as { files?: unknown } | null)?.files
  const manifest: Manifest = { version: 1, files: {} }
  if (files && typeof files === 'object') for (const [local, entry] of Object.entries(files)) if (isEntry(entry)) manifest.files[local] = entry
  return manifest
}

/** Rereads before writing so parallel CLI calls (background jobs) lose as little as possible. */
export async function updateManifest(path: string, change: (manifest: Manifest) => void | Promise<void>): Promise<void> {
  const manifest = await readManifest(path)
  await change(manifest)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
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

/** Regular files below a directory, skipping dot-names (editor and tool droppings) and symlinks. */
export async function* walkFiles(directory: string): AsyncGenerator<string> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(path)
    else if (entry.isFile()) yield path
  }
}

const mirrorRemote = (local: string, mirrorRoot: string) => relative(mirrorRoot, local).split(sep).join('/')

/** Local-only comparison against the manifest; nothing here asks Pulpo. */
export async function localStatus(mirrorRoot: string, manifest: Manifest): Promise<LocalStatus> {
  const status: LocalStatus = { modified: [], added: [], deleted: [] }
  const seen = new Set<string>()
  for await (const local of walkFiles(mirrorRoot)) {
    seen.add(local)
    const entry = manifest.files[local]; const sha256 = await sha256File(local)
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

/**
 * Chooses what `push` sends. Without paths: every modified or new file. Named files always go
 * (the server reports "unchanged"); named directories contribute only modified and new files.
 */
export async function planPush(input: { mirrorRoot: string; manifest: Manifest; locals: string[]; to?: string; force: boolean }): Promise<PushItem[]> {
  const { mirrorRoot, manifest, force } = input
  let candidates: Array<{ local: string; sha256: string; explicit: boolean }> = []
  if (!input.locals.length) {
    if (input.to !== undefined) throw new UsageError('--to needs exactly one local file.', 'push')
    const status = await localStatus(mirrorRoot, manifest)
    candidates = [...status.modified, ...status.added].map(({ local, sha256 }) => ({ local, sha256, explicit: false }))
  } else {
    const seen = new Set<string>()
    const add = async (local: string, explicit: boolean) => {
      if (seen.has(local)) return
      seen.add(local)
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
  return candidates.map(({ local, sha256 }) => {
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
