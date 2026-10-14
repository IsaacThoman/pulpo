import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { DEFAULT_FILE_ACCESS_MODE, FILE_SCOPE_ROOT, fileAccessModeSchema, fileNameError, normalizeFileName, type FileAccessMode } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { chats, fileNodes } from '../../database/schema.js'
import type { FileExecutor, FileNodeRow } from '../access.js'
import { fileNameMessage } from '../names.js'
import { filesFeatureEnabled } from '../request.js'
import { chainIds } from '../tree-service.js'

/** A `pulpo files` failure the agent can act on; its message is what the agent sees. */
export class FilesCommandError extends Error {}

/** A starting point for paths: an attached item no other attached folder contains, or all files (`node` null). */
export interface FileScopeRoot {
  /** First path segment for this root; empty for all files. */
  label: string
  node: FileNodeRow | null
}

/** One item the user attached, with the path the agent uses for it. */
export interface AttachedFileItem {
  /** Agent path; empty for all files. */
  path: string
  node: FileNodeRow | null
  /** Where a top-level attachment sits in the user's Files, e.g. `Work/Q3`; null at the top. */
  location: string | null
  mode: FileAccessMode
}

export interface FileScope {
  userId: string
  roots: FileScopeRoot[]
  attached: AttachedFileItem[]
  /** The access mode of each attached entry, keyed like `chats.file_scope_ids`. */
  modes: ReadonlyMap<string, FileAccessMode>
}

export function isAllFiles(scope: FileScope): boolean {
  return scope.roots.length === 1 && !scope.roots[0]!.node
}

function accessMode(value: unknown): FileAccessMode {
  return fileAccessModeSchema.safeParse(value).data ?? DEFAULT_FILE_ACCESS_MODE
}

async function nodeNames(executor: FileExecutor, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const rows = unique.length ? await executor.select({ id: fileNodes.id, name: fileNodes.name }).from(fileNodes).where(inArray(fileNodes.id, unique)) : []
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * Resolves a chat's scope. Items inside another attached folder (or anywhere, with all files
 * attached) stay listed on their own, since the user pointed at them, but are reached through
 * that folder's path; the rest become path roots, with names made unique.
 */
export async function loadFileScope(userId: string, scopeIds: readonly string[], access: Readonly<Record<string, string>> = {}): Promise<FileScope> {
  const all = scopeIds.includes(FILE_SCOPE_ROOT)
  const ids = [...new Set(scopeIds.filter((id) => id !== FILE_SCOPE_ROOT))]
  const rows = ids.length ? await db.select().from(fileNodes).where(and(
    inArray(fileNodes.id, ids),
    eq(fileNodes.ownerUserId, userId),
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
    ne(fileNodes.kind, 'shortcut'),
  )) : []
  const byId = new Map(rows.map((row) => [row.id, row]))
  const live = ids.flatMap((id) => byId.get(id) ?? [])
  // Each item's chain up to the top, nearest first, with the names along it.
  const chains = new Map(await Promise.all(live.map(async (row) => [row.id, await chainIds(db, userId, row.id)] as const)))
  const names = await nodeNames(db, [...chains.values()].flat())
  const nameOf = (id: string) => names.get(id) ?? '?'

  const modes = new Map<string, FileAccessMode>()
  if (all) modes.set(FILE_SCOPE_ROOT, accessMode(access[FILE_SCOPE_ROOT]))
  for (const row of live) modes.set(row.id, accessMode(access[row.id]))

  const roots: FileScopeRoot[] = all ? [{ label: '', node: null }] : []
  const rootLabels = new Map<string, string>()
  if (!all) {
    const used = new Map<string, number>()
    for (const row of live) {
      if (chains.get(row.id)!.slice(1).some((id) => byId.has(id))) continue
      const count = (used.get(row.name.toLowerCase()) ?? 0) + 1
      used.set(row.name.toLowerCase(), count)
      const label = count > 1 ? `${row.name} (${count})` : row.name
      rootLabels.set(row.id, label)
      roots.push({ label, node: row })
    }
  }

  const attached: AttachedFileItem[] = []
  for (const id of scopeIds) {
    if (id === FILE_SCOPE_ROOT) {
      if (!attached.some((item) => !item.node)) attached.push({ path: '', node: null, location: null, mode: modes.get(FILE_SCOPE_ROOT)! })
      continue
    }
    const row = byId.get(id)
    if (!row || attached.some((item) => item.node?.id === id)) continue
    const chain = chains.get(id)!
    const mode = modes.get(id)!
    if (all) {
      attached.push({ path: [...chain].reverse().map(nameOf).join('/'), node: row, location: null, mode })
      continue
    }
    // The outermost attached folder above the item is the root its path starts from.
    const rootIndex = chain.findLastIndex((chainId) => rootLabels.has(chainId))
    const rootId = chain[rootIndex]!
    const path = [rootLabels.get(rootId)!, ...chain.slice(0, rootIndex).reverse().map(nameOf)].join('/')
    const location = rootId === id && chain.length > 1 ? chain.slice(1).reverse().map(nameOf).join('/') : null
    attached.push({ path, node: row, location, mode })
  }
  return { userId, roots, attached, modes }
}

/**
 * The scope an agent reply works with: the chat's attached items, re-read on every request so
 * the user's changes to the scope apply at once. Null while Files is off and for temporary chats.
 */
export async function loadChatFileScope(userId: string, chatId: string): Promise<FileScope | null> {
  const [chat] = await db.select({ temporary: chats.temporary, scopeIds: chats.fileScopeIds, access: chats.fileScopeAccess })
    .from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt))).limit(1)
  if (!chat || chat.temporary || !await filesFeatureEnabled()) return null
  return loadFileScope(userId, chat.scopeIds, chat.access)
}

/**
 * What the agent may do with an item (null: the top of My files): the mode of the nearest
 * attached entry at or above it, else the all-files mode. Null when the item is outside the scope.
 */
export async function modeFor(scope: FileScope, nodeId: string | null, executor: FileExecutor = db): Promise<FileAccessMode | null> {
  if (nodeId) {
    for (const id of await chainIds(executor, scope.userId, nodeId)) {
      const mode = scope.modes.get(id)
      if (mode) return mode
    }
  }
  return scope.modes.get(FILE_SCOPE_ROOT) ?? null
}

export function splitPath(path: string): string[] {
  const segments = path.trim().replace(/^\/+|\/+$/g, '').split('/').map((segment) => normalizeFileName(segment)).filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new FilesCommandError('Paths cannot contain "." or ".." segments')
  return segments
}

function rootNames(scope: FileScope): string {
  return scope.roots.map((root) => `"${root.label}"`).join(', ')
}

export async function childNamed(userId: string, parentId: string | null, name: string, executor: FileExecutor = db): Promise<FileNodeRow | undefined> {
  const [row] = await executor.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
    // Shortcuts are navigation aids for people; the agent works with the items themselves.
    ne(fileNodes.kind, 'shortcut'),
    sql`lower(${fileNodes.name}) = ${name.toLowerCase()}`,
  )).limit(1)
  return row
}

/** A resolved location; `node` null is the top of the user's Files (all-files scope only). */
export interface Located {
  node: FileNodeRow | null
  /** The path with every name as stored. */
  path: string
}

/** Walks a path from the scope roots one child at a time, so nothing outside the scope can be named. */
export async function locate(scope: FileScope, path: string): Promise<Located | null> {
  const segments = splitPath(path)
  let node: FileNodeRow | null = null
  let names: string[] = []
  let rest = segments
  if (!isAllFiles(scope)) {
    if (!segments.length) throw new FilesCommandError(`Give a path that starts with ${rootNames(scope)}`)
    const root = scope.roots.find((candidate) => candidate.label.toLowerCase() === segments[0]!.toLowerCase())
    if (!root) throw new FilesCommandError(`"${segments[0]}" is not attached to this chat. Paths start with ${rootNames(scope)}`)
    node = root.node
    names = [root.label]
    rest = segments.slice(1)
  }
  for (const segment of rest) {
    if (node && node.kind !== 'folder') return null
    const next = await childNamed(scope.userId, node?.id ?? null, segment)
    if (!next) return null
    node = next
    names.push(next.name)
  }
  return { node, path: names.join('/') }
}

/** Like `locate`, but an unknown top-level name is simply absent, so creating it explains where items go. */
export async function locateOptional(scope: FileScope, path: string): Promise<Located | null> {
  try {
    return await locate(scope, path)
  } catch (error) {
    if (error instanceof FilesCommandError && splitPath(path).length === 1) return null
    throw error
  }
}

/** Resolves a path that must name an existing item. */
export async function locateExisting(scope: FileScope, path: string): Promise<Located> {
  const located = await locate(scope, path)
  if (!located) throw new FilesCommandError(`"${path}" does not exist in Files; list its folder with pulpo files ls`)
  return located
}

/** The folder a new item at `path` would go in, and the item's name and path. */
export async function locateParent(scope: FileScope, path: string): Promise<{ parent: Located; name: string; path: string }> {
  const segments = splitPath(path)
  if (!segments.length) throw new FilesCommandError('Give the path of the item')
  if (!isAllFiles(scope) && segments.length === 1) {
    const folders = scope.roots.filter((root) => root.node?.kind === 'folder')
    throw new FilesCommandError(folders.length
      ? `New items must go inside an attached folder: start the path with ${folders.map((root) => `"${root.label}"`).join(', ')}`
      : 'No folder is attached to this chat, so nothing new can be added; ask the user to attach one')
  }
  const parentPath = segments.slice(0, -1).join('/')
  const parent = segments.length === 1 ? { node: null, path: '' } : await locate(scope, parentPath)
  if (!parent) throw new FilesCommandError(`The folder "${parentPath}" does not exist; create it first with pulpo files mkdir`)
  if (parent.node && parent.node.kind !== 'folder') throw new FilesCommandError(`"${parent.path}" is a file, not a folder`)
  const name = segments.at(-1)!
  const invalid = fileNameError(name)
  if (invalid) throw new FilesCommandError(`"${name}" is not a valid name: ${fileNameMessage(invalid)}`)
  return { parent, name, path: parent.path ? `${parent.path}/${name}` : name }
}

/** The agent's path for an item (null: the top of My files), or null when it is outside the scope. */
export async function scopePathOf(scope: FileScope, nodeId: string | null, executor: FileExecutor = db): Promise<string | null> {
  if (!nodeId) return isAllFiles(scope) ? '' : null
  const chain = await chainIds(executor, scope.userId, nodeId)
  const names = await nodeNames(executor, chain)
  if (isAllFiles(scope)) return [...chain].reverse().map((id) => names.get(id)).join('/')
  const rootIndex = chain.findLastIndex((id) => scope.roots.some((root) => root.node?.id === id))
  if (rootIndex < 0) return null
  const root = scope.roots.find((candidate) => candidate.node?.id === chain[rootIndex])!
  return [root.label, ...chain.slice(0, rootIndex).reverse().map((id) => names.get(id))].join('/')
}

/** Where an item sits from the top of My files, e.g. `Work/Plan.md`. */
export async function filesPathOf(executor: FileExecutor, userId: string, nodeId: string | null): Promise<string> {
  if (!nodeId) return ''
  const chain = await chainIds(executor, userId, nodeId)
  const names = await nodeNames(executor, chain)
  return [...chain].reverse().map((id) => names.get(id) ?? '?').join('/')
}
