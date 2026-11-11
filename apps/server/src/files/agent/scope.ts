import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { BROWSED_FILES_MODE_LIMIT, DEFAULT_FILE_ACCESS_MODE, FILE_SCOPE_ROOT, fileAccessModeSchema, fileNameError, normalizeFileName, type FileAccessMode } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { chats, fileNodes, userPreferences } from '../../database/schema.js'
import type { FileExecutor, FileNodeRow } from '../access.js'
import { fileNameMessage } from '../names.js'
import { filesFeatureEnabled } from '../request.js'
import { chainIds } from '../tree-service.js'

/** A `pulpo files` failure the agent can act on; its message is what the agent sees. */
export class FilesCommandError extends Error {}

/**
 * A path the agent may not reach without the user's permission: listing or searching My files, or
 * naming anything outside the items mentioned in the chat. Raised before anything is revealed, even
 * whether the item exists.
 */
export class FilesPermissionNeeded extends FilesCommandError {
  constructor(readonly path: string) {
    super(`Looking at "${path || 'My files'}" needs the user's permission to browse their Files`)
  }
}

/** One item mentioned in (or attached to) the chat, with its path from the top of My files. */
export interface AttachedFileItem {
  /** Path from the top of My files; empty for all files. */
  path: string
  node: FileNodeRow | null
  mode: FileAccessMode
}

export interface FileScope {
  userId: string
  attached: AttachedFileItem[]
  /** The access mode of each attached entry, keyed like `chats.file_scope_ids`. */
  modes: ReadonlyMap<string, FileAccessMode>
  /** Folders above attached items, which their paths pass through without revealing what else they hold. */
  passThrough: ReadonlySet<string>
  /** What the agent may change; items reached only by browsing take at most BROWSED_FILES_MODE_LIMIT. */
  changeMode: FileAccessMode
  /** Why the agent may browse all of the user's Files, if it may. */
  browse: 'chat' | 'account' | null
  /** The chat's stored scope this was loaded from. */
  source: { ids: readonly string[]; access: Readonly<Record<string, string>>; changeMode: string; browseAllowed: boolean }
}

const MODE_ORDER: FileAccessMode[] = ['read', 'suggest', 'write']

/** The more restrictive of two modes; null (outside the scope) restricts most. */
export function stricterMode(left: FileAccessMode | null, right: FileAccessMode | null): FileAccessMode | null {
  if (!left || !right) return null
  return MODE_ORDER[Math.min(MODE_ORDER.indexOf(left), MODE_ORDER.indexOf(right))]!
}

/** Whether the agent may reach everything: all files attached, or browsing allowed. */
export function reachesAllFiles(scope: FileScope): boolean {
  return scope.browse !== null || scope.modes.has(FILE_SCOPE_ROOT)
}

function accessMode(value: unknown, fallback: FileAccessMode = DEFAULT_FILE_ACCESS_MODE): FileAccessMode {
  return fileAccessModeSchema.safeParse(value).data ?? fallback
}

async function nodeNames(executor: FileExecutor, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const rows = unique.length ? await executor.select({ id: fileNodes.id, name: fileNodes.name }).from(fileNodes).where(inArray(fileNodes.id, unique)) : []
  return new Map(rows.map((row) => [row.id, row.name]))
}

export interface FileScopeOptions {
  changeMode?: string
  /** Browsing allowed for this chat. */
  browseAllowed?: boolean
  /** Browsing allowed by the account, which stopped asking. */
  browseByAccount?: boolean
}

/**
 * Resolves a chat's scope. Paths always start at the top of My files. Entries without their own
 * mode (set per item by older clients) follow the chat's change mode.
 */
export async function loadFileScope(userId: string, scopeIds: readonly string[], access: Readonly<Record<string, string>> = {}, options: FileScopeOptions = {}): Promise<FileScope> {
  const changeMode = accessMode(options.changeMode)
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
  if (all) modes.set(FILE_SCOPE_ROOT, accessMode(access[FILE_SCOPE_ROOT], changeMode))
  for (const row of live) modes.set(row.id, accessMode(access[row.id], changeMode))
  const passThrough = new Set<string>()
  for (const chain of chains.values()) for (const id of chain.slice(1)) passThrough.add(id)

  const attached: AttachedFileItem[] = []
  for (const id of scopeIds) {
    if (id === FILE_SCOPE_ROOT) {
      if (!attached.some((item) => !item.node)) attached.push({ path: '', node: null, mode: modes.get(FILE_SCOPE_ROOT)! })
      continue
    }
    const row = byId.get(id)
    if (!row || attached.some((item) => item.node?.id === id)) continue
    attached.push({ path: [...chains.get(id)!].reverse().map(nameOf).join('/'), node: row, mode: modes.get(id)! })
  }
  const browse = options.browseAllowed ? 'chat' : options.browseByAccount ? 'account' : null
  return {
    userId, attached, modes, passThrough, changeMode, browse,
    source: { ids: [...scopeIds], access: { ...access }, changeMode: options.changeMode ?? DEFAULT_FILE_ACCESS_MODE, browseAllowed: options.browseAllowed ?? false },
  }
}

/** Whether the account lets Agent replies browse Files without asking. */
export async function accountAllowsBrowsing(userId: string): Promise<boolean> {
  const [row] = await db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  return (row?.values as Record<string, unknown> | undefined)?.agentFilesAskBeforeBrowsing === false
}

/**
 * The scope an agent reply works with: the chat's mentioned items, re-read on every request so
 * the user's changes apply at once. Null while Files is off and for temporary chats.
 */
export async function loadChatFileScope(userId: string, chatId: string): Promise<FileScope | null> {
  const [chat] = await db.select({
    temporary: chats.temporary, scopeIds: chats.fileScopeIds, access: chats.fileScopeAccess,
    changeMode: chats.fileChangeMode, browseAllowed: chats.filesBrowseAllowed,
  }).from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt))).limit(1)
  if (!chat || chat.temporary || !await filesFeatureEnabled()) return null
  return loadFileScope(userId, chat.scopeIds, chat.access, {
    changeMode: chat.changeMode, browseAllowed: chat.browseAllowed, browseByAccount: await accountAllowsBrowsing(userId),
  })
}

function sameAccess(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key])
}

/**
 * Inside a change's transaction: fails unless the chat's attached items and their access are
 * still what `scope` was loaded from. The chat row stays share-locked until the transaction
 * ends, so a change to them made meanwhile waits for this one.
 */
export async function assertScopeCurrent(executor: FileExecutor, chatId: string, scope: FileScope): Promise<void> {
  const [chat] = await executor.select({ ids: chats.fileScopeIds, access: chats.fileScopeAccess, changeMode: chats.fileChangeMode, browseAllowed: chats.filesBrowseAllowed }).from(chats)
    .where(eq(chats.id, chatId)).for('share')
  const unchanged = chat && chat.ids.length === scope.source.ids.length && chat.ids.every((id, index) => id === scope.source.ids[index])
    && sameAccess(chat.access, scope.source.access) && chat.changeMode === scope.source.changeMode
    // Browsing allowed meanwhile only widens what the agent may reach; revoking it must stop the change.
    && (chat.browseAllowed || !scope.source.browseAllowed)
  if (!unchanged) throw new FilesCommandError('The items in this chat or what you may do with them just changed; run the command again')
}

/**
 * What the agent may do with an item (null: the top of My files): the mode of the nearest
 * attached entry at or above it, else the all-files mode, else, while browsing is allowed, the
 * change mode limited to suggestions. Null when the agent may not reach the item.
 */
export async function modeFor(scope: FileScope, nodeId: string | null, executor: FileExecutor = db): Promise<FileAccessMode | null> {
  if (nodeId) {
    for (const id of await chainIds(executor, scope.userId, nodeId)) {
      const mode = scope.modes.get(id)
      if (mode) return mode
    }
  }
  const all = scope.modes.get(FILE_SCOPE_ROOT)
  if (all) return all
  return scope.browse ? stricterMode(scope.changeMode, BROWSED_FILES_MODE_LIMIT) : null
}

/** Attached items inside an item (not the item itself): their own modes apply to them. */
export async function attachedInside(scope: FileScope, nodeId: string, executor: FileExecutor = db): Promise<AttachedFileItem[]> {
  const inside: AttachedFileItem[] = []
  for (const item of scope.attached) {
    if (!item.node || item.node.id === nodeId) continue
    if ((await chainIds(executor, scope.userId, item.node.id)).includes(nodeId)) inside.push(item)
  }
  return inside
}

export function splitPath(path: string): string[] {
  const segments = path.trim().replace(/^\/+|\/+$/g, '').split('/').map((segment) => normalizeFileName(segment)).filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new FilesCommandError('Paths cannot contain "." or ".." segments')
  return segments
}

export async function childNamed(userId: string, parentId: string | null, name: string, executor: FileExecutor = db): Promise<FileNodeRow | undefined> {
  const [row] = await executor.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
    // Shortcuts are navigation aids for people; the agent works with the items themselves.
    ne(fileNodes.kind, 'shortcut'),
    // Both sides in SQL: JavaScript and PostgreSQL lowercase some letters (İ) differently.
    sql`lower(${fileNodes.name}) = lower(${name})`,
  )).limit(1)
  return row
}

/** A resolved location; `node` null is the top of the user's Files. */
export interface Located {
  node: FileNodeRow | null
  /** The path with every name as stored. */
  path: string
}

/**
 * Walks a path from the top of My files one child at a time. Outside the attached items (unless
 * the agent may browse), only the folders leading to them can be named, and naming anything else,
 * or any of those folders themselves, raises FilesPermissionNeeded.
 */
export async function locate(scope: FileScope, path: string, options: { passThrough?: boolean } = {}): Promise<Located | null> {
  const segments = splitPath(path)
  let node: FileNodeRow | null = null
  let inside = reachesAllFiles(scope)
  const names: string[] = []
  for (const segment of segments) {
    if (node && node.kind !== 'folder') return null
    const next = await childNamed(scope.userId, node?.id ?? null, segment)
    if (!inside && !(next && (scope.modes.has(next.id) || scope.passThrough.has(next.id)))) {
      throw new FilesPermissionNeeded([...names, segment].join('/'))
    }
    if (!next) return null
    node = next
    names.push(next.name)
    if (scope.modes.has(next.id)) inside = true
  }
  // A folder on the way to attached items may be named as a step, but not looked into.
  if (!inside && !(options.passThrough && node)) throw new FilesPermissionNeeded(names.join('/'))
  return { node, path: names.join('/') }
}

/** Whether reaching `path` needs the user's permission first. */
export async function needsPermission(scope: FileScope, path: string): Promise<boolean> {
  try {
    await locate(scope, path)
    return false
  } catch (error) {
    return error instanceof FilesPermissionNeeded
  }
}

/** Like `locate`, for a path that may not exist yet. */
export async function locateOptional(scope: FileScope, path: string, options: { passThrough?: boolean } = {}): Promise<Located | null> {
  return locate(scope, path, options)
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
  const parentPath = segments.slice(0, -1).join('/')
  const parent = await locate(scope, parentPath)
  if (!parent) throw new FilesCommandError(`The folder "${parentPath}" does not exist; create it first with pulpo files mkdir`)
  if (parent.node && parent.node.kind !== 'folder') throw new FilesCommandError(`"${parent.path}" is a file, not a folder`)
  const name = segments.at(-1)!
  const invalid = fileNameError(name)
  if (invalid) throw new FilesCommandError(`"${name}" is not a valid name: ${fileNameMessage(invalid)}`)
  return { parent, name, path: parent.path ? `${parent.path}/${name}` : name }
}

/** The agent's path for an item (null: the top of My files), or null when it may not reach it. */
export async function scopePathOf(scope: FileScope, nodeId: string | null, executor: FileExecutor = db): Promise<string | null> {
  if (await modeFor(scope, nodeId, executor) === null) return null
  return filesPathOf(executor, scope.userId, nodeId)
}

/** Where an item sits from the top of My files, e.g. `Work/Plan.md`. */
export async function filesPathOf(executor: FileExecutor, userId: string, nodeId: string | null): Promise<string> {
  if (!nodeId) return ''
  const chain = await chainIds(executor, userId, nodeId)
  const names = await nodeNames(executor, chain)
  return [...chain].reverse().map((id) => names.get(id) ?? '?').join('/')
}
