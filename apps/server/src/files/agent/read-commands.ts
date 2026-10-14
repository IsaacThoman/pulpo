import { Readable } from 'node:stream'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { FILE_TREE_MAX_DEPTH } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { fileChanges } from '../../database/schema.js'
import { getBlobStore } from '../../storage/index.js'
import type { FileNodeRow } from '../access.js'
import { parsePlace } from './changes.js'
import { formatSize, joinPath, type CommandContext, type CommandOutput } from './command-context.js'
import { readProposedMarkdown } from './docs.js'
import { createLineMatcher } from './matcher.js'
import { MODE_LABELS } from './prompt.js'
import { FilesCommandError, isAllFiles, locateExisting, modeFor, scopePathOf, type Located } from './scope.js'
import { agentBlobView, readsAsText } from './versions.js'
import { walkTree, type WalkedNode } from './walk.js'

const LIST_LIMIT = 300
const LIST_MAX_DEPTH = 8
const TREE_LIMIT = 500
const TEXT_READ_LIMIT_BYTES = 2_000_000
const GREP_MAX_FILES = 2_000
const GREP_MAX_READ_BYTES = 20 * 1024 * 1024
const GREP_MAX_MATCHES = 200
const GREP_LINE_CHARS = 300

/** Notes on items the agent proposed changes to, or that are proposals themselves, keyed by node id. */
async function pendingNotes(ctx: CommandContext, nodes: FileNodeRow[]): Promise<Map<string, string[]>> {
  const notes = new Map<string, string[]>()
  const add = (id: string, note: string) => notes.set(id, [...notes.get(id) ?? [], note])
  for (const node of nodes) if (node.suggestionChangeId) add(node.id, 'suggested, not accepted yet')
  const ids = nodes.map((node) => node.id)
  const rows = ids.length ? await db.select({ nodeId: fileChanges.nodeId, kind: fileChanges.kind, after: fileChanges.after }).from(fileChanges).where(and(
    eq(fileChanges.chatId, ctx.chatId), eq(fileChanges.status, 'pending'), inArray(fileChanges.nodeId, ids),
  )).orderBy(asc(fileChanges.seq)) : []
  for (const row of rows) {
    if (row.kind === 'update') add(row.nodeId, 'you suggested new content, not accepted yet')
    if (row.kind === 'trash') add(row.nodeId, 'you suggested deleting it')
    if (row.kind === 'move') {
      const { parentId, name } = parsePlace(row.after) ?? { parentId: null, name: '?' }
      const folder = await scopePathOf(ctx.scope, parentId)
      add(row.nodeId, `you suggested moving it to ${folder === null ? `"${name}" outside the attached items` : `"${joinPath(folder, name)}"`}`)
    }
  }
  return notes
}

function describeNode(ctx: CommandContext, node: FileNodeRow, notes: Map<string, string[]>): string {
  const parts = node.kind === 'folder' ? ['folder'] : [
    node.kind === 'doc' ? 'Markdown document' : node.mimeType ?? 'file',
    formatSize(node.sizeBytes),
    `updated ${node.updatedAt.toISOString().slice(0, 10)}`,
  ]
  const mode = ctx.scope.modes.get(node.id)
  return [...parts, ...mode ? [MODE_LABELS[mode]] : [], ...notes.get(node.id) ?? []].join(', ')
}

function itemLine(ctx: CommandContext, item: { node: FileNodeRow; path: string }, notes: Map<string, string[]>): string {
  return `${item.path}${item.node.kind === 'folder' ? '/' : ''}  (${describeNode(ctx, item.node, notes)})`
}

/** `ls [path] [-R]`: the attached items, or what a folder holds. */
export async function listCommand(ctx: CommandContext, args: { path?: string; recursive?: boolean }): Promise<CommandOutput> {
  const path = args.path ?? ''
  if (!path.replace(/\//g, '').trim() && !isAllFiles(ctx.scope)) {
    const roots = ctx.scope.roots.map((root) => ({ node: root.node!, path: root.label }))
    const notes = await pendingNotes(ctx, roots.map((root) => root.node))
    return { output: roots.map((root) => itemLine(ctx, root, notes)).join('\n') }
  }
  const located = await locateExisting(ctx.scope, path)
  if (located.node && located.node.kind !== 'folder') {
    return { output: itemLine(ctx, { node: located.node, path: located.path }, await pendingNotes(ctx, [located.node])) }
  }
  const { nodes, truncated } = await walkTree(ctx.userId, { id: located.node?.id ?? null, path: located.path }, {
    maxDepth: args.recursive ? LIST_MAX_DEPTH : 1, maxNodes: LIST_LIMIT,
  })
  if (!nodes.length) return { output: `"${located.path || 'My files'}" is empty` }
  const notes = await pendingNotes(ctx, nodes.map((item) => item.node))
  const lines = nodes.map((item) => itemLine(ctx, item, notes))
  if (truncated) lines.push(`[Only the first ${LIST_LIMIT} items are shown; list a folder inside to see more.]`)
  return { output: lines.join('\n') }
}

/** `tree [path] [--depth N]`: an indented outline of a folder. */
export async function treeCommand(ctx: CommandContext, args: { path?: string; depth?: number }): Promise<CommandOutput> {
  const starts: Located[] = !(args.path ?? '').replace(/\//g, '').trim() && !isAllFiles(ctx.scope)
    ? ctx.scope.roots.map((root) => ({ node: root.node, path: root.label }))
    : [await locateExisting(ctx.scope, args.path ?? '')]
  const lines: string[] = []
  let truncated = false
  for (const start of starts) {
    if (lines.length >= TREE_LIMIT) break
    lines.push(`${start.path || 'My files'}${start.node?.kind === 'doc' || start.node?.kind === 'blob' ? '' : '/'}`)
    if (start.node && start.node.kind !== 'folder') continue
    const walked = await walkTree(ctx.userId, { id: start.node?.id ?? null, path: start.path }, {
      maxDepth: args.depth ?? 3, maxNodes: Math.max(0, TREE_LIMIT - lines.length),
    })
    truncated ||= walked.truncated
    for (const item of walked.nodes) lines.push(`${'  '.repeat(item.depth)}${item.node.name}${item.node.kind === 'folder' ? '/' : ''}`)
  }
  if (truncated || lines.length > TREE_LIMIT) lines.push(`[Only the first ${TREE_LIMIT} lines are shown; look inside a folder to see more.]`)
  return { output: lines.slice(0, TREE_LIMIT + 1).join('\n') }
}

async function readBlobText(key: string): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of await getBlobStore().getStream(key) as Readable) chunks.push(Buffer.from(chunk as Uint8Array))
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

/**
 * A file's text as the agent sees it (documents with suggestions accepted, uploaded files with
 * this chat's proposed content), or null when it is not readable text of a reasonable size.
 */
async function agentText(ctx: CommandContext, node: FileNodeRow): Promise<string | null> {
  if (node.kind === 'doc') return readProposedMarkdown(node.id)
  const view = await agentBlobView(db, ctx.chatId, node, () => modeFor(ctx.scope, node.id))
  if (!readsAsText(node.name, view.mimeType) || view.sizeBytes > TEXT_READ_LIMIT_BYTES) return null
  try {
    return await readBlobText(view.objectKey)
  } catch {
    return null
  }
}

/** `cat <path>`: a document's Markdown or a text file. */
export async function catCommand(ctx: CommandContext, args: { path: string }): Promise<CommandOutput> {
  const located = await locateExisting(ctx.scope, args.path)
  if (!located.node || located.node.kind === 'folder') throw new FilesCommandError(`"${located.path || 'My files'}" is a folder; list it with pulpo files ls`)
  const text = await agentText(ctx, located.node)
  if (text === null) {
    throw new FilesCommandError(`"${located.path}" is not a text file Pulpo can print (${located.node.mimeType ?? 'binary'}, ${formatSize(located.node.sizeBytes)}); pull it to work with it in the workspace`)
  }
  return { output: text }
}

/** The files a search covers: everything under `path`, or under every attached item. */
async function searchedFiles(ctx: CommandContext, path: string | undefined): Promise<{ files: WalkedNode[]; truncated: boolean }> {
  const starts: Located[] = path?.replace(/\//g, '').trim() || isAllFiles(ctx.scope)
    ? [await locateExisting(ctx.scope, path ?? '')]
    : ctx.scope.roots.map((root) => ({ node: root.node, path: root.label }))
  const files: WalkedNode[] = []
  let truncated = false
  for (const start of starts) {
    if (start.node && start.node.kind !== 'folder') {
      files.push({ node: start.node, path: start.path, depth: 0 })
      continue
    }
    const walked = await walkTree(ctx.userId, { id: start.node?.id ?? null, path: start.path }, { maxDepth: FILE_TREE_MAX_DEPTH, maxNodes: GREP_MAX_FILES * 4 })
    truncated ||= walked.truncated
    files.push(...walked.nodes.filter((item) => item.node.kind !== 'folder'))
  }
  return { files: files.slice(0, GREP_MAX_FILES), truncated: truncated || files.length > GREP_MAX_FILES }
}

/** `grep [-i] [-F] <pattern> [path]`: matching lines as `path:line: text`. */
export async function grepCommand(ctx: CommandContext, args: { pattern: string; path?: string; ignoreCase?: boolean; fixed?: boolean }): Promise<CommandOutput> {
  const match = createLineMatcher(args.pattern, args)
  const { files, truncated } = await searchedFiles(ctx, args.path)
  const lines: string[] = []
  let readBytes = 0
  let stopped: string | null = truncated ? `Searched only the first ${GREP_MAX_FILES} files; search a folder inside to cover the rest.` : null
  for (const file of files) {
    if (readBytes >= GREP_MAX_READ_BYTES) {
      stopped = 'Stopped after reading 20 MB; search a folder inside to cover the rest.'
      break
    }
    const text = await agentText(ctx, file.node)
    if (text === null) continue
    readBytes += Buffer.byteLength(text, 'utf8')
    const fileLines = text.split(/\r?\n/)
    for (const index of match(fileLines).slice(0, GREP_MAX_MATCHES - lines.length)) {
      const line = fileLines[index]!
      lines.push(`${file.path}:${index + 1}: ${line.length > GREP_LINE_CHARS ? `${line.slice(0, GREP_LINE_CHARS)}…` : line}`)
    }
    if (lines.length >= GREP_MAX_MATCHES) {
      stopped = `Stopped after ${GREP_MAX_MATCHES} matches; narrow the pattern or the folder.`
      break
    }
  }
  if (!lines.length && !stopped) return { output: 'No matches' }
  return { output: [...lines, ...stopped ? [`[${stopped}]`] : []].join('\n') }
}
