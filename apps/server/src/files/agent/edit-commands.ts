import type { FileAccessMode } from '@pulpo/contracts'
import type { FileExecutor, FileNodeRow } from '../access.js'
import { changeMode, guardedReply, joinPath, stricterMode, type CommandContext, type CommandOutput } from './command-context.js'
import { createFolderChange, moveChange, trashChange } from './mutations.js'
import { attachedInside, FilesCommandError, locateExisting, locateOptional, locateParent, modeFor, splitPath, type Located } from './scope.js'

/**
 * The mode for moving or deleting an item with everything inside: the strictest of its own and
 * of the attached items within it, which the user may have protected more than their folder.
 */
async function wholeItemMode(ctx: CommandContext, located: Located & { node: FileNodeRow }, executor?: FileExecutor): Promise<FileAccessMode | null> {
  let mode = await modeFor(ctx.scope, located.node.id, executor)
  if (mode === 'read') return mode
  for (const item of await attachedInside(ctx.scope, located.node.id, executor)) {
    if (item.mode === 'read') {
      throw new FilesCommandError(`"${located.path}" holds "${item.path}", which is read only. Leave it out, or ask the user to allow changes to it.`)
    }
    mode = stricterMode(mode, item.mode)
  }
  return mode
}

async function createFolderAt(ctx: CommandContext, parent: Located, name: string, path: string): Promise<string> {
  const parentId = parent.node?.id ?? null
  const mode = changeMode(await modeFor(ctx.scope, parentId), parent.path)
  const { status } = await createFolderChange(guardedReply(ctx, mode, (executor) => modeFor(ctx.scope, parentId, executor)), parentId, name, mode)
  ctx.changed = true
  return status === 'created' ? `Created the folder "${path}/"` : `Suggested the new folder "${path}/"; it waits for the user to accept it`
}

/** `mkdir [-p] <path>`: a new folder; with `parents`, every missing folder along the path. */
export async function mkdirCommand(ctx: CommandContext, args: { path: string; parents?: boolean }): Promise<CommandOutput> {
  const segments = splitPath(args.path)
  const lines: string[] = []
  for (let index = args.parents ? 1 : segments.length; index <= segments.length; index += 1) {
    const prefix = segments.slice(0, index).join('/')
    const existing = await locateOptional(ctx.scope, prefix)
    if (existing) {
      if (existing.node && existing.node.kind !== 'folder') throw new FilesCommandError(`"${existing.path}" is a file, not a folder`)
      if (!args.parents) throw new FilesCommandError(`"${existing.path}" already exists`)
      continue
    }
    const { parent, name, path } = await locateParent(ctx.scope, prefix)
    lines.push(await createFolderAt(ctx, parent, name, path))
  }
  return { output: lines.length ? lines.join('\n') : `"${args.path}" already exists` }
}

/**
 * Where `mv` puts an item: inside `to` when that is an existing folder (keeping the name),
 * otherwise at the new path `to`, whose folder must exist.
 */
async function moveTarget(ctx: CommandContext, source: Located, to: string): Promise<{ parent: Located; name: string; path: string }> {
  const existing = await locateOptional(ctx.scope, to)
  if (existing && existing.node?.id !== source.node!.id) {
    if (existing.node && existing.node.kind !== 'folder') throw new FilesCommandError(`"${existing.path}" already exists`)
    return { parent: existing, name: source.node!.name, path: joinPath(existing.path, source.node!.name) }
  }
  return locateParent(ctx.scope, to)
}

/** `mv <from> <to>`: moves or renames an item; both places must allow changes. */
export async function mvCommand(ctx: CommandContext, args: { from: string; to: string }): Promise<CommandOutput> {
  const source = await locateExisting(ctx.scope, args.from)
  if (!source.node) throw new FilesCommandError('The top of My files cannot be moved')
  const target = await moveTarget(ctx, source, args.to)
  const item = { ...source, node: source.node }
  const parentId = target.parent.node?.id ?? null
  const modeIn = async (executor?: FileExecutor) => stricterMode(await wholeItemMode(ctx, item, executor), await modeFor(ctx.scope, parentId, executor))
  const sourceMode = await wholeItemMode(ctx, item)
  const mode = changeMode(await modeIn(), sourceMode === 'read' ? source.path : target.parent.path)
  const result = await moveChange(guardedReply(ctx, mode, modeIn), source.node.id, { parentId, name: target.name }, mode)
  if (result === 'unchanged') return { output: `"${source.path}" is already there` }
  ctx.changed = true
  return {
    output: result === 'moved'
      ? `Moved "${source.path}" to "${target.path}"`
      : `Suggested moving "${source.path}" to "${target.path}"; it waits for the user to accept it`,
  }
}

/** `rm [-r] <path>`: moves an item to the trash, where the user can restore it. */
export async function rmCommand(ctx: CommandContext, args: { path: string; recursive?: boolean }): Promise<CommandOutput> {
  const located = await locateExisting(ctx.scope, args.path)
  if (!located.node) throw new FilesCommandError('The top of My files cannot be deleted')
  if (located.node.kind === 'folder' && !args.recursive) {
    throw new FilesCommandError(`"${located.path}" is a folder; use pulpo files rm -r to delete it with everything inside`)
  }
  const item = { ...located, node: located.node }
  const mode = changeMode(await wholeItemMode(ctx, item), located.path)
  const result = await trashChange(guardedReply(ctx, mode, (executor) => wholeItemMode(ctx, item, executor)), located.node.id, mode)
  ctx.changed = true
  const messages = {
    trashed: `Moved "${located.path}" to the trash; the user can restore it from there`,
    suggested: `Suggested deleting "${located.path}"; it waits for the user to accept it`,
    withdrawn: `Removed "${located.path}", which you had suggested adding`,
  }
  return { output: messages[result] }
}
