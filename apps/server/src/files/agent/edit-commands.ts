import { changeMode, joinPath, stricterMode, type CommandContext, type CommandOutput } from './command-context.js'
import { createFolderChange, moveChange, trashChange } from './mutations.js'
import { FilesCommandError, locateExisting, locateOptional, locateParent, modeFor, splitPath, type Located } from './scope.js'

async function createFolderAt(ctx: CommandContext, parent: Located, name: string, path: string): Promise<string> {
  const mode = changeMode(await modeFor(ctx.scope, parent.node?.id ?? null), parent.path)
  const { status } = await createFolderChange(ctx, parent.node?.id ?? null, name, mode)
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
  const sourceMode = await modeFor(ctx.scope, source.node.id)
  const targetMode = await modeFor(ctx.scope, target.parent.node?.id ?? null)
  const mode = changeMode(stricterMode(sourceMode, targetMode), sourceMode === 'read' ? source.path : target.parent.path)
  const result = await moveChange(ctx, source.node.id, { parentId: target.parent.node?.id ?? null, name: target.name }, mode)
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
  const mode = changeMode(await modeFor(ctx.scope, located.node.id), located.path)
  const result = await trashChange(ctx, located.node.id, mode)
  ctx.changed = true
  const messages = {
    trashed: `Moved "${located.path}" to the trash; the user can restore it from there`,
    suggested: `Suggested deleting "${located.path}"; it waits for the user to accept it`,
    withdrawn: `Removed "${located.path}", which you had suggested adding`,
  }
  return { output: messages[result] }
}
