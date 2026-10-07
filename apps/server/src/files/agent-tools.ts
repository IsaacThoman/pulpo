import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { FILE_SCOPE_ROOT, fileNameError, isMarkdownName, normalizeFileName } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileAgentChanges, fileNodes } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import type { FileNodeRow } from './access.js'
import { createDoc, readDocMarkdown, writeDocMarkdown } from './doc-store.js'
import { chainIds, createFolder, trashFileNodes } from './tree-service.js'

const LIST_LIMIT = 300
const LIST_MAX_DEPTH = 8
const TEXT_READ_LIMIT_BYTES = 2_000_000
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql|log|ini|cfg|conf|env)$/i

/** A starting point for paths: an attached item no other attached folder contains, or all files (`node` null). */
export interface FileScopeEntry {
  /** First path segment for this entry; empty for all files. */
  label: string
  node: FileNodeRow | null
}

/** One item the user attached, with the path the tools use for it. */
export interface AttachedFileItem {
  /** Tool path; empty for all files. */
  path: string
  node: FileNodeRow | null
  /** Where a top-level attachment sits in the user's Files, e.g. `Work/Q3`; null at the top. */
  location: string | null
}

export interface FileScope {
  roots: FileScopeEntry[]
  attached: AttachedFileItem[]
}

/**
 * Resolves a chat's scope. Items inside another attached folder (or anywhere, with all files
 * attached) stay listed on their own, since the user pointed at them, but are reached through
 * that folder's path; the rest become path roots, with names made unique.
 */
export async function loadFileScope(userId: string, scopeIds: readonly string[]): Promise<FileScope> {
  const all = scopeIds.includes(FILE_SCOPE_ROOT)
  const ids = [...new Set(scopeIds.filter((id) => id !== FILE_SCOPE_ROOT))]
  const rows = ids.length ? await db.select().from(fileNodes).where(and(
    inArray(fileNodes.id, ids),
    eq(fileNodes.ownerUserId, userId),
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
  )) : []
  const byId = new Map(rows.map((row) => [row.id, row]))
  const live = ids.flatMap((id) => byId.get(id) ?? [])
  // Each item's chain up to the top, nearest first, with the names along it.
  const chains = new Map(await Promise.all(live.map(async (row) => [row.id, await chainIds(db, userId, row.id)] as const)))
  const chainNodeIds = [...new Set([...chains.values()].flat())]
  const names = new Map((chainNodeIds.length
    ? await db.select({ id: fileNodes.id, name: fileNodes.name }).from(fileNodes).where(inArray(fileNodes.id, chainNodeIds))
    : []).map((row) => [row.id, row.name]))
  const nameOf = (id: string) => names.get(id) ?? byId.get(id)?.name ?? '?'

  const roots: FileScopeEntry[] = all ? [{ label: '', node: null }] : []
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
      if (!attached.some((item) => !item.node)) attached.push({ path: '', node: null, location: null })
      continue
    }
    const row = byId.get(id)
    if (!row || attached.some((item) => item.node?.id === id)) continue
    const chain = chains.get(id)!
    if (all) {
      attached.push({ path: [...chain].reverse().map(nameOf).join('/'), node: row, location: null })
      continue
    }
    // The outermost attached folder above the item is the root its path starts from.
    const rootIndex = chain.findLastIndex((chainId) => rootLabels.has(chainId))
    const rootId = chain[rootIndex]!
    const inner = chain.slice(0, rootIndex).reverse().map(nameOf)
    const path = [rootLabels.get(rootId)!, ...inner].join('/')
    const location = rootId === id && chain.length > 1 ? chain.slice(1).reverse().map(nameOf).join('/') : null
    attached.push({ path, node: row, location })
  }
  return { roots, attached }
}

function describeKind(node: FileNodeRow): string {
  if (node.kind === 'folder') return 'folder, with everything inside it'
  return node.kind === 'doc' ? 'Markdown document' : 'uploaded file, read-only'
}

/** The system prompt section that tells the agent what the user attached and how to reach it. */
export function describeFileScope(scope: FileScope): string {
  const lines = scope.attached.map((item) => {
    if (!item.node) return '- All of their files. Paths start at the top of their Files, e.g. `Projects/Plan.md`; `files_list` with no path lists the top level.'
    const folder = item.node.kind === 'folder' ? '/' : ''
    const where = item.location ? `; it is in their Files at \`${item.location}/\`` : ''
    return `- \`${item.path}${folder}\` (${describeKind(item.node)}${where})`
  })
  const all = scope.roots.length === 1 && !scope.roots[0]!.node
  const start = all
    ? 'Paths start at the top of their Files.'
    : `Paths start with ${scope.roots.map((root) => `\`${root.label}\``).join(', ')}.`
  return [
    '# Files',
    'The user attached these items from their Files to this chat. Work with them through the `files_*` tools, which reach only these items (and everything inside attached folders):',
    ...lines,
    `${start} An item listed inside an attached folder is one the user pointed out specifically. Markdown files (.md) are live documents: the user sees your edits as you make them and can undo all of a response's changes. Other files are read-only uploads. Read a document before editing it, prefer \`files_edit\` for changes to part of a document, and keep the user's structure and formatting.`,
  ].join('\n')
}

class FileToolError extends Error {}

function splitPath(path: string): string[] {
  const segments = path.trim().replace(/^\/+|\/+$/g, '').split('/').map((segment) => segment.trim()).filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new FileToolError('Paths cannot contain "." or ".." segments')
  return segments
}

async function childNamed(userId: string, parentId: string | null, name: string): Promise<FileNodeRow | undefined> {
  const [row] = await db.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
    ne(fileNodes.kind, 'shortcut'),
    sql`lower(${fileNodes.name}) = ${name.toLowerCase()}`,
  )).limit(1)
  return row
}

async function children(userId: string, parentId: string | null): Promise<FileNodeRow[]> {
  return db.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
    // Shortcuts are navigation aids for people; the agent works with the items themselves.
    ne(fileNodes.kind, 'shortcut'),
  )).orderBy(desc(sql`${fileNodes.kind} = 'folder'`), asc(sql`lower(${fileNodes.name})`)).limit(LIST_LIMIT + 1)
}

/** A resolved location; `node` null is the top of the user's Files (all-files scope only). */
interface Located { node: FileNodeRow | null; path: string }

function scopeNames(scope: FileScopeEntry[]): string {
  return scope.map((entry) => `"${entry.label}"`).join(', ')
}

/** Walks a path from the scope roots, so nothing outside the scope can be named. */
async function locate(userId: string, scope: FileScopeEntry[], path: string): Promise<Located | null> {
  const segments = splitPath(path)
  const all = scope.length === 1 && !scope[0]!.node
  let node: FileNodeRow | null
  let rest: string[]
  if (all) {
    node = null
    rest = segments
  } else {
    if (!segments.length) throw new FileToolError(`Give a path that starts with ${scopeNames(scope)}`)
    const entry = scope.find((candidate) => candidate.label.toLowerCase() === segments[0]!.toLowerCase())
    if (!entry) throw new FileToolError(`"${segments[0]}" is not attached to this chat. Paths start with ${scopeNames(scope)}`)
    node = entry.node
    rest = segments.slice(1)
  }
  for (const segment of rest) {
    if (node && node.kind !== 'folder') return null
    const next = await childNamed(userId, node?.id ?? null, segment)
    if (!next) return null
    node = next
  }
  return { node, path: segments.join('/') }
}

/** Like `locate`, but a new top-level name is simply absent, so creating it explains where items go. */
async function locateForCreate(userId: string, scope: FileScopeEntry[], path: string): Promise<Located | null> {
  try {
    return await locate(userId, scope, path)
  } catch (error) {
    if (error instanceof FileToolError && splitPath(path).length === 1) return null
    throw error
  }
}

/** The folder a new item at `path` would go in, and the item's name. */
async function locateParent(userId: string, scope: FileScopeEntry[], path: string): Promise<{ parentId: string | null; name: string }> {
  const segments = splitPath(path)
  if (!segments.length) throw new FileToolError('Give the path of the item to create')
  const all = scope.length === 1 && !scope[0]!.node
  if (!all && segments.length === 1) {
    throw new FileToolError(`New items must go inside an attached folder: start the path with one of ${scopeNames(scope.filter((entry) => entry.node?.kind === 'folder'))}`)
  }
  const parent = segments.length === 1 ? { node: null, path: '' } : await locate(userId, scope, segments.slice(0, -1).join('/'))
  if (!parent) throw new FileToolError(`The folder "${segments.slice(0, -1).join('/')}" does not exist; create it first`)
  if (parent.node && parent.node.kind !== 'folder') throw new FileToolError(`"${parent.path}" is a file, not a folder`)
  const name = normalizeFileName(segments.at(-1)!)
  const invalid = fileNameError(name)
  if (invalid) throw new FileToolError(`"${name}" is not a valid name (${invalid.replaceAll('_', ' ')})`)
  return { parentId: parent.node?.id ?? null, name }
}

async function recordChange(userId: string, responseId: string, nodeId: string, kind: 'edit' | 'create', beforeMarkdown?: string): Promise<void> {
  // The first change per item wins, so undo restores what the response started from.
  await db.insert(fileAgentChanges).values({ id: newId(), responseId, userId, nodeId, kind, beforeMarkdown: beforeMarkdown ?? null })
    .onConflictDoNothing()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeNode(node: FileNodeRow): string {
  if (node.kind === 'folder') return 'folder'
  const kind = node.kind === 'doc' ? 'Markdown document' : `${node.mimeType ?? 'file'}, read-only`
  return `${kind}, ${formatSize(node.sizeBytes)}, updated ${node.updatedAt.toISOString().slice(0, 10)}`
}

function truncate(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= maxBytes) return text
  return `${bytes.subarray(0, maxBytes).toString('utf8').replace(/�$/, '')}\n\n[Truncated: the file is ${formatSize(bytes.byteLength)}; only the start is shown.]`
}

function readsAsText(node: FileNodeRow): boolean {
  const mime = node.mimeType ?? ''
  return mime.startsWith('text/') || /json|xml|yaml|csv|javascript|typescript|markdown/.test(mime) || TEXT_EXTENSIONS.test(node.name)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requireString(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = args[key]
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new FileToolError(`${key} is required`)
  return value
}

function result(text: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], details }
}

/** Replaces each `old_text` with its `new_text`; every `old_text` must occur exactly once. */
export function applyTextEdits(source: string, edits: Array<{ oldText: string; newText: string }>): string {
  let text = source
  for (const [index, edit] of edits.entries()) {
    const first = text.indexOf(edit.oldText)
    if (first < 0) throw new FileToolError(`Edit ${index + 1}: old_text was not found. Read the document again and copy the text exactly.`)
    if (text.indexOf(edit.oldText, first + 1) >= 0) throw new FileToolError(`Edit ${index + 1}: old_text appears more than once; include more surrounding text.`)
    text = text.slice(0, first) + edit.newText + text.slice(first + edit.oldText.length)
  }
  return text
}

/**
 * Agent tools for the Files items attached to a chat. Every path is resolved from the chat's
 * scope, documents are edited as minimal diffs that reach open editors live, and each change
 * is recorded so the response can be undone.
 */
export function createFilesTools(input: {
  userId: string
  responseId: string
  scope: FileScope
  maxOutputBytes: number
  onOperationStarted?: (operationId: string) => void | Promise<void>
}): AgentTool[] {
  const { userId, responseId } = input
  const scope = input.scope.roots
  if (!scope.length) return []
  const run = <T>(operation: (args: Record<string, unknown>) => Promise<T>) =>
    async (id: string, rawArgs: unknown, signal?: AbortSignal): Promise<T> => {
      signal?.throwIfAborted()
      await input.onOperationStarted?.(id)
      try {
        return await operation(record(rawArgs))
      } catch (error) {
        // Tree rules (name clashes, depth) come back as the user-facing message.
        if (error instanceof AppError) throw new Error(error.message, { cause: error })
        throw error
      }
    }
  const pathParameter = (description: string) => Type.String({ minLength: 1, maxLength: 2_000, description })

  const list: AgentTool = {
    name: 'files_list',
    label: 'files_list',
    description: 'List the attached Files items, or the contents of a folder among them. Folders end with "/".',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ maxLength: 2_000, description: 'Folder to list. Omit to list the attached items.' })),
      recursive: Type.Optional(Type.Boolean({ description: 'Include everything below the folder.' })),
    }, { additionalProperties: false }),
    executionMode: 'parallel',
    execute: run(async (args) => {
      const path = typeof args.path === 'string' ? args.path : ''
      const all = scope.length === 1 && !scope[0]!.node
      if (!splitPath(path).length && !all) {
        const lines = scope.map((entry) => `${entry.label}${entry.node!.kind === 'folder' ? '/' : ''}  (${describeNode(entry.node!)})`)
        return result(lines.join('\n'), { kind: 'files_list', path: '' })
      }
      const located = await locate(userId, scope, path)
      if (!located) throw new FileToolError(`"${path}" does not exist`)
      if (located.node && located.node.kind !== 'folder') {
        return result(`${located.path}  (${describeNode(located.node)})`, { kind: 'files_list', path: located.path })
      }
      const lines: string[] = []
      let truncated = false
      const walk = async (parentId: string | null, prefix: string, depth: number) => {
        const rows = await children(userId, parentId)
        for (const row of rows.slice(0, LIST_LIMIT)) {
          if (lines.length >= LIST_LIMIT) { truncated = true; return }
          const itemPath = prefix ? `${prefix}/${row.name}` : row.name
          lines.push(`${itemPath}${row.kind === 'folder' ? '/' : ''}  (${describeNode(row)})`)
          if (args.recursive === true && row.kind === 'folder' && depth < LIST_MAX_DEPTH) await walk(row.id, itemPath, depth + 1)
        }
        if (rows.length > LIST_LIMIT) truncated = true
      }
      await walk(located.node?.id ?? null, located.path, 1)
      if (!lines.length) return result(`"${located.path || 'My files'}" is empty`, { kind: 'files_list', path: located.path })
      if (truncated) lines.push(`[Only the first ${LIST_LIMIT} items are shown.]`)
      return result(lines.join('\n'), { kind: 'files_list', path: located.path })
    }),
  }

  const read: AgentTool = {
    name: 'files_read',
    label: 'files_read',
    description: 'Read a Markdown document or a text file from the attached Files items.',
    parameters: Type.Object({ path: pathParameter('File to read.') }, { additionalProperties: false }),
    executionMode: 'parallel',
    execute: run(async (args) => {
      const path = requireString(args, 'path')
      const located = await locate(userId, scope, path)
      if (!located?.node) throw new FileToolError(`"${path}" does not exist`)
      const node = located.node
      if (node.kind === 'folder') throw new FileToolError(`"${located.path}" is a folder; use files_list`)
      let text: string
      if (node.kind === 'doc') {
        text = (await readDocMarkdown(userId, node.id)).markdown
      } else {
        if (!readsAsText(node) || !node.objectKey) throw new FileToolError(`"${located.path}" is a ${node.mimeType ?? 'binary'} file and cannot be read as text`)
        if (node.sizeBytes > TEXT_READ_LIMIT_BYTES) throw new FileToolError(`"${located.path}" is too large to read (${formatSize(node.sizeBytes)})`)
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(await getBlobStore().get(node.objectKey))
        } catch {
          throw new FileToolError(`"${located.path}" is not UTF-8 text`)
        }
      }
      return result(truncate(text, input.maxOutputBytes), { kind: 'files_read', nodeId: node.id, path: located.path })
    }),
  }

  const write: AgentTool = {
    name: 'files_write',
    label: 'files_write',
    description: 'Create a Markdown document (.md), or replace the whole content of an existing one. Use files_edit to change part of a document.',
    parameters: Type.Object({
      path: pathParameter('Document to create or replace, ending in .md.'),
      content: Type.String({ maxLength: 1_000_000, description: 'The complete Markdown content.' }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: run(async (args) => {
      const path = requireString(args, 'path')
      const content = requireString(args, 'content', true)
      const located = await locateForCreate(userId, scope, path)
      if (located?.node) {
        const node = located.node
        if (node.kind === 'folder') throw new FileToolError(`"${located.path}" is a folder`)
        if (node.kind !== 'doc') throw new FileToolError(`"${located.path}" is an uploaded file and cannot be edited${isMarkdownName(node.name) ? '; the user can open it and choose Edit to make it editable' : ''}`)
        const written = await writeDocMarkdown({ nodeId: node.id, actorUserId: userId, markdown: content, origin: 'agent' })
        if (written) await recordChange(userId, responseId, node.id, 'edit', written.before)
        return result(written ? `Replaced the content of ${located.path}` : `${located.path} already had this content`, { kind: 'files_change', change: 'edit', nodeId: node.id, path: located.path })
      }
      const { parentId, name } = await locateParent(userId, scope, path)
      if (!isMarkdownName(name)) throw new FileToolError('Only Markdown documents (.md) can be created')
      const created = await createDoc(userId, { parentId, name, markdown: content })
      await recordChange(userId, responseId, created.id, 'create')
      const createdPath = [...splitPath(path).slice(0, -1), created.name].join('/')
      return result(`Created ${createdPath}`, { kind: 'files_change', change: 'create', nodeId: created.id, path: createdPath })
    }),
  }

  const edit: AgentTool = {
    name: 'files_edit',
    label: 'files_edit',
    description: 'Change part of a Markdown document by replacing exact text. Each old_text must appear exactly once in the document as files_read returns it.',
    parameters: Type.Object({
      path: pathParameter('Document to edit.'),
      edits: Type.Array(Type.Object({
        old_text: Type.String({ minLength: 1, maxLength: 100_000 }),
        new_text: Type.String({ maxLength: 100_000 }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 20 }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: run(async (args) => {
      const path = requireString(args, 'path')
      if (!Array.isArray(args.edits) || !args.edits.length) throw new FileToolError('edits must list at least one change')
      const edits = args.edits.map((value) => {
        const item = record(value)
        if (typeof item.old_text !== 'string' || typeof item.new_text !== 'string') throw new FileToolError('Each edit needs old_text and new_text')
        return { oldText: item.old_text, newText: item.new_text }
      })
      const located = await locate(userId, scope, path)
      if (!located?.node) throw new FileToolError(`"${path}" does not exist`)
      if (located.node.kind !== 'doc') throw new FileToolError(`"${located.path}" is not an editable Markdown document`)
      const current = (await readDocMarkdown(userId, located.node.id)).markdown
      const written = await writeDocMarkdown({ nodeId: located.node.id, actorUserId: userId, markdown: applyTextEdits(current, edits), origin: 'agent' })
      if (written) await recordChange(userId, responseId, located.node.id, 'edit', written.before)
      return result(written ? `Edited ${located.path}` : `${located.path} was unchanged`, { kind: 'files_change', change: 'edit', nodeId: located.node.id, path: located.path })
    }),
  }

  const createFolderTool: AgentTool = {
    name: 'files_create_folder',
    label: 'files_create_folder',
    description: 'Create a folder inside the attached Files items.',
    parameters: Type.Object({ path: pathParameter('Folder to create; its parent must exist.') }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: run(async (args) => {
      const path = requireString(args, 'path')
      if (await locateForCreate(userId, scope, path)) throw new FileToolError(`"${path}" already exists`)
      const { parentId, name } = await locateParent(userId, scope, path)
      const created = await createFolder(userId, { parentId, name })
      await recordChange(userId, responseId, created.id, 'create')
      return result(`Created the folder ${path.replace(/\/+$/, '')}/`, { kind: 'files_change', change: 'create', nodeId: created.id, path })
    }),
  }

  return [list, read, write, edit, createFolderTool]
}

export interface FileChangeSummary {
  nodeId: string
  name: string
  nodeKind: 'folder' | 'doc' | 'blob'
  change: 'edit' | 'create'
  reverted: boolean
}

/** What a response changed in the user's Files. */
export async function listFileChanges(userId: string, responseId: string): Promise<FileChangeSummary[]> {
  const rows = await db.select({
    nodeId: fileAgentChanges.nodeId, change: fileAgentChanges.kind, revertedAt: fileAgentChanges.revertedAt,
    name: fileNodes.name, nodeKind: fileNodes.kind,
  }).from(fileAgentChanges).innerJoin(fileNodes, eq(fileNodes.id, fileAgentChanges.nodeId))
    .where(and(eq(fileAgentChanges.responseId, responseId), eq(fileAgentChanges.userId, userId)))
    .orderBy(asc(fileAgentChanges.createdAt))
  return rows.map((row) => ({
    nodeId: row.nodeId, name: row.name, nodeKind: row.nodeKind as FileChangeSummary['nodeKind'],
    change: row.change as FileChangeSummary['change'], reverted: row.revertedAt !== null,
  }))
}

/**
 * Undoes a response's Files changes: documents get back the Markdown they had before it (as a
 * minimal diff, so later edits elsewhere survive), and items it created move to the trash.
 */
export async function revertFileChanges(userId: string, responseId: string): Promise<{ reverted: number }> {
  const rows = await db.select().from(fileAgentChanges).where(and(
    eq(fileAgentChanges.responseId, responseId),
    eq(fileAgentChanges.userId, userId),
    isNull(fileAgentChanges.revertedAt),
  )).orderBy(desc(fileAgentChanges.createdAt))
  if (!rows.length) return { reverted: 0 }
  const nodes = await db.select().from(fileNodes).where(and(
    inArray(fileNodes.id, rows.map((row) => row.nodeId)), eq(fileNodes.ownerUserId, userId), isNull(fileNodes.trashedAt),
  ))
  const live = new Map(nodes.map((node) => [node.id, node]))
  for (const row of rows) {
    const node = live.get(row.nodeId)
    if (row.kind === 'edit' && node?.kind === 'doc' && row.beforeMarkdown !== null) {
      await writeDocMarkdown({ nodeId: node.id, actorUserId: userId, markdown: row.beforeMarkdown, origin: 'restore' })
    }
  }
  const created = rows.filter((row) => row.kind === 'create' && live.has(row.nodeId)).map((row) => row.nodeId)
  if (created.length) await trashFileNodes(userId, created)
  await db.update(fileAgentChanges).set({ revertedAt: new Date() }).where(inArray(fileAgentChanges.id, rows.map((row) => row.id)))
  return { reverted: rows.length }
}
