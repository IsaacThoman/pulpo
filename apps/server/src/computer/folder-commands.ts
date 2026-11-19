import type { ComputerFolderChange, ComputerFolderChangeResult, ComputerFolderEntry, ComputerFolderMode } from '@pulpo/contracts'
import type { FilesWorkspace } from '../files/agent/command-context.js'
import { folderPath, FolderCommandError, formatSize, isFolderPath, isWithin, joinFolderPath } from './folder-paths.js'
import { computerCall, ComputerRequestError, type ComputerSessionRef } from './tunnel.js'

const LIST_LIMIT = 300
/** The most text `cat` asks for: one socket message carries it, even when JSON escapes swell it. */
const CAT_MAX_BYTES = 1024 * 1024
const LIST_MAX_DEPTH = 8
const TREE_LIMIT = 500
const TREE_DEFAULT_DEPTH = 3
const GREP_MAX_MATCHES = 200
const GREP_LINE_CHARS = 300
const SKIPPED_NAMED = 10

/** One relayed `pulpo computer` command. */
export interface FolderContext {
  session: ComputerSessionRef
  responseId: string
  mode: ComputerFolderMode
  /** The shared folder's name, for messages. */
  name: string
  workspace: FilesWorkspace
  maxOutputBytes: number
  signal?: AbortSignal
  /** What this command applied or suggested, added to the reply's totals afterwards. */
  /** Paths this command changed or suggested changing; the reply counts each path once. */
  changes: { applied: Set<string>; suggested: Set<string> }
}

export interface FolderOutput {
  output: string
  data?: unknown
}

export function readOnlyMessage(ctx: FolderContext): string {
  return `The folder "${ctx.name}" on the user's computer is read only. If it should change, ask the user; they can allow changes in the Pulpo Agent menu below the message box.`
}

/** Changes are refused here in read-only mode before the desktop app (which refuses too) is asked. */
export function assertWritable(ctx: FolderContext): void {
  if (ctx.mode === 'read') throw new FolderCommandError(readOnlyMessage(ctx))
}

const display = (ctx: FolderContext, path: string) => path || ctx.name

/** Folders left out by name, as a closing note. */
export function skippedNote(skipped: string[] | undefined): string[] {
  if (!skipped?.length) return []
  const named = skipped.slice(0, SKIPPED_NAMED).map((path) => `"${path}"`).join(', ')
  const more = skipped.length > SKIPPED_NAMED ? ` and ${skipped.length - SKIPPED_NAMED} more` : ''
  return [`[Left out ${skipped.length === 1 ? 'the folder' : `${skipped.length} folders`} ${named}${more}: folders named .git and node_modules are skipped. List one directly to look inside.]`]
}

/** Answers the desktop app gives are checked against the folder asked about. */
function entriesUnder(entries: ComputerFolderEntry[], path: string): ComputerFolderEntry[] {
  return entries.filter((entry) => isFolderPath(entry.path) && isWithin(entry.path, path))
}

const isFileAt = (entries: ComputerFolderEntry[], path: string) => path !== '' && entries.length === 1 && entries[0]!.kind === 'file' && entries[0]!.path === path

function entryLine(entry: ComputerFolderEntry): string {
  if (entry.kind === 'folder') return `${entry.path}/  (folder)`
  return `${entry.path}  (file, ${formatSize(entry.sizeBytes)}${/^\d{4}-\d\d-\d\d/.test(entry.modifiedAt) ? `, modified ${entry.modifiedAt.slice(0, 10)}` : ''})`
}

/** `ls [path] [-R]`. */
export async function listCommand(ctx: FolderContext, args: { path?: string; recursive?: boolean }): Promise<FolderOutput> {
  const path = folderPath(args.path ?? '')
  const listed = await computerCall(ctx.session, 'folder.list', { path, depth: args.recursive ? LIST_MAX_DEPTH : 1, limit: LIST_LIMIT }, { signal: ctx.signal })
  const entries = entriesUnder(listed.entries, path)
  if (!entries.length) return { output: [`"${display(ctx, path)}" is empty`, ...skippedNote(listed.skipped)].join('\n') }
  const lines = entries.map(entryLine)
  if (listed.truncated) lines.push(`[Only the first ${entries.length} items are shown; list a folder inside to see more.]`)
  return { output: [...lines, ...skippedNote(listed.skipped)].join('\n') }
}

/** `tree [path] [--depth N]`: an indented outline. */
export async function treeCommand(ctx: FolderContext, args: { path?: string; depth?: number }): Promise<FolderOutput> {
  const path = folderPath(args.path ?? '')
  const listed = await computerCall(ctx.session, 'folder.list', { path, depth: args.depth ?? TREE_DEFAULT_DEPTH, limit: TREE_LIMIT }, { signal: ctx.signal })
  const entries = entriesUnder(listed.entries, path)
  if (isFileAt(entries, path)) return { output: path }
  const base = path ? path.split('/').length : 0
  const lines = [`${display(ctx, path)}/`, ...entries.map((entry) => {
    const segments = entry.path.split('/')
    return `${'  '.repeat(Math.max(1, segments.length - base))}${segments.at(-1)}${entry.kind === 'folder' ? '/' : ''}`
  })]
  if (listed.truncated) lines.push(`[Only the first ${entries.length} items are shown; look inside a folder to see more.]`)
  return { output: [...lines, ...skippedNote(listed.skipped)].join('\n') }
}

/** `cat <path>`: a UTF-8 text file. */
export async function catCommand(ctx: FolderContext, args: { path: string }): Promise<FolderOutput> {
  const path = folderPath(args.path)
  if (!path) throw new FolderCommandError(`"${ctx.name}" is a folder; list it with pulpo computer ls`)
  // The reply is cut to maxOutputBytes anyway, so nothing longer needs to cross the socket.
  const read = await computerCall(ctx.session, 'folder.read', { path, maxBytes: Math.min(ctx.maxOutputBytes, CAT_MAX_BYTES) }, { signal: ctx.signal })
  return { output: read.truncated ? `${read.text}\n[Output truncated (${formatSize(read.sizeBytes)} in all); pull the file to see the rest.]` : read.text }
}

/** `grep [-i] [-F] <pattern> [path]`: matching lines as `path:line:text`. */
export async function grepCommand(ctx: FolderContext, args: { pattern: string; path?: string; ignoreCase?: boolean; fixed?: boolean }): Promise<FolderOutput> {
  const path = folderPath(args.path ?? '')
  const found = await computerCall(ctx.session, 'folder.search', {
    pattern: args.pattern, path, limit: GREP_MAX_MATCHES,
    ...args.ignoreCase ? { ignoreCase: true } : {}, ...args.fixed ? { fixed: true } : {},
  }, { signal: ctx.signal })
  const lines = found.matches.slice(0, GREP_MAX_MATCHES).map(({ path: file, line, text }) => {
    const shown = text.replace(/\r?\n$/, '')
    return `${file}:${line}:${shown.length > GREP_LINE_CHARS ? `${shown.slice(0, GREP_LINE_CHARS)}…` : shown}`
  })
  if (!lines.length && !found.truncated) return { output: 'No matches' }
  if (found.truncated) lines.push(`[Stopped after ${lines.length} matches; narrow the pattern or the folder.]`)
  return { output: lines.join('\n') }
}

const changedPath = (change: ComputerFolderChange) => change.kind === 'move' ? change.from : change.path

/** Sends one change and counts it; refusals become errors, since a single change has nothing else to report. */
async function change(ctx: FolderContext, change: ComputerFolderChange, messages: { applied: string; suggested: string; unchanged: string }): Promise<FolderOutput> {
  assertWritable(ctx)
  const result: ComputerFolderChangeResult = await computerCall(ctx.session, 'folder.change', { change, responseId: ctx.responseId }, { signal: ctx.signal })
  switch (result.status) {
    case 'created': case 'updated': ctx.changes.applied.add(changedPath(change)); return { output: messages.applied }
    case 'suggested': ctx.changes.suggested.add(changedPath(change)); return { output: messages.suggested }
    case 'unchanged': return { output: result.message || messages.unchanged }
    case 'denied': throw new FolderCommandError(result.message || readOnlyMessage(ctx))
    default: throw new FolderCommandError(result.message || `The user's computer could not make this change (${result.status})`)
  }
}

const required = (ctx: FolderContext, value: string, what: string) => {
  const path = folderPath(value)
  if (!path) throw new FolderCommandError(`The shared folder "${ctx.name}" itself cannot be ${what}`)
  return path
}

/** `mkdir [-p] <path>`. */
export async function mkdirCommand(ctx: FolderContext, args: { path: string; parents?: boolean }): Promise<FolderOutput> {
  const path = required(ctx, args.path, 'created')
  return change(ctx, { kind: 'mkdir', path, ...args.parents ? { parents: true } : {} }, {
    applied: `Created the folder "${path}/"`,
    suggested: `Suggested the new folder "${path}/"; it waits for the user to accept it`,
    unchanged: `"${path}" already exists`,
  })
}

/** Like `mv`: into `to` when it is an existing folder, keeping the name; otherwise to the new path `to`. */
async function moveTarget(ctx: FolderContext, from: string, to: string): Promise<string> {
  if (from.toLowerCase() === to.toLowerCase()) return to
  let entries: ComputerFolderEntry[]
  try {
    entries = (await computerCall(ctx.session, 'folder.list', { path: to, depth: 1, limit: 1 }, { signal: ctx.signal })).entries
  } catch (error) {
    if (error instanceof ComputerRequestError && error.code === 'not_found') return to
    throw error
  }
  // A file lists as itself (the name may differ in case on a case-insensitive disk); a folder lists its children.
  const file = entries.length === 1 && entries[0]!.kind === 'file' && entries[0]!.path.toLowerCase() === to.toLowerCase()
  return file ? to : joinFolderPath(to, from.split('/').at(-1)!)
}

/** `mv <from> <to>`. */
export async function mvCommand(ctx: FolderContext, args: { from: string; to: string }): Promise<FolderOutput> {
  assertWritable(ctx)
  const from = required(ctx, args.from, 'moved')
  const to = await moveTarget(ctx, from, required(ctx, args.to, 'replaced'))
  if (isWithin(to, from) && to !== from) throw new FolderCommandError(`"${from}" cannot be moved inside itself`)
  return change(ctx, { kind: 'move', from, to }, {
    applied: `Moved "${from}" to "${to}"`,
    suggested: `Suggested moving "${from}" to "${to}"; it waits for the user to accept it`,
    unchanged: `"${from}" is already there`,
  })
}

/** `rm [-r] <path>`: the desktop app moves the item to the computer's trash. */
export async function rmCommand(ctx: FolderContext, args: { path: string; recursive?: boolean }): Promise<FolderOutput> {
  const path = required(ctx, args.path, 'removed')
  return change(ctx, { kind: 'remove', path, ...args.recursive ? { recursive: true } : {} }, {
    applied: `Moved "${path}" to the trash on the user's computer; they can restore it from there`,
    suggested: `Suggested deleting "${path}"; it waits for the user to accept it`,
    unchanged: `"${path}" is already gone`,
  })
}
