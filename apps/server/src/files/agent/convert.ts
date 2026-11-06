import { canExportOfficePdf, convertedFileName, fileExtension, officeConversionTarget, type OfficeEditableFormat } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { convertOfficeDocument, OFFICE_CONVERTER_MAX_INPUT_BYTES, officeConversionAvailable, withConversionSlot } from '../office/converter.js'
import { assertConvertedSizeAllowed, readStoredObject } from '../office/service.js'
import { changeMode, guardedReply, joinPath, type CommandContext, type CommandOutput } from './command-context.js'
import { createBlobChange } from './mutations.js'
import { FilesCommandError, locateExisting, locateOptional, locateParent, modeFor } from './scope.js'
import { agentBlobView } from './versions.js'

export interface ConvertArgs {
  path: string
  to: OfficeEditableFormat | 'pdf'
  output?: string
}

const UNAVAILABLE = 'Converting files is not available on this Pulpo server. Convert it in your workspace instead (for example `soffice --headless --convert-to docx file.doc`) and push the result.'

/**
 * Where the converted file goes: `output`, which must not exist yet, or beside the source under
 * the next free name. Either way it must be inside an attached folder.
 */
async function destination(ctx: CommandContext, sourcePath: string, sourceName: string, args: ConvertArgs) {
  const folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
  const requested = args.output ?? joinPath(folder, convertedFileName(sourceName, args.to))
  let place: Awaited<ReturnType<typeof locateParent>>
  try {
    place = await locateParent(ctx.scope, requested)
  } catch (error) {
    if (args.output || !(error instanceof FilesCommandError)) throw error
    throw new FilesCommandError(`${error.message}. Choose where the converted file goes with --output <path>`)
  }
  if (fileExtension(place.name) !== args.to) throw new FilesCommandError(`--output must end in .${args.to}`)
  const parentId = place.parent.node?.id ?? null
  if (args.output) {
    if (await locateOptional(ctx.scope, args.output)) throw new FilesCommandError(`"${place.path}" already exists; choose another --output path`)
    return { parentId, parentPath: place.parent.path, name: place.name, path: place.path }
  }
  // The free name is picked again when the file is created, after the conversion.
  return { parentId, parentPath: place.parent.path, name: place.name, path: place.path }
}

/**
 * `convert <path> --to <format> [--output <path>]`: a converted copy of an office file, created
 * like a pushed file (in the mode its folder allows, recorded for undo and review). The source
 * is read as the agent sees it, including this chat's pending proposal for it.
 */
export async function convertCommand(ctx: CommandContext, args: ConvertArgs): Promise<CommandOutput> {
  if (!officeConversionAvailable()) throw new FilesCommandError(UNAVAILABLE)
  const located = await locateExisting(ctx.scope, args.path)
  const node = located.node
  if (!node || node.kind !== 'blob') throw new FilesCommandError(`"${located.path || 'My files'}" is not an uploaded file; only office files (.doc, .xls, .ppt, .odt, .pages, .docx, …) can be converted`)
  const supported = args.to === 'pdf' ? canExportOfficePdf(node.name) : officeConversionTarget(node.name) === args.to
  if (!supported) {
    const target = officeConversionTarget(node.name)
    throw new FilesCommandError(target || canExportOfficePdf(node.name)
      ? `"${located.path}" converts to ${target ? `.${target} or ` : ''}.pdf, not .${args.to}`
      : `"${located.path}" is not an office file Pulpo can convert`)
  }
  const sourceMode = await modeFor(ctx.scope, node.id)
  const view = await agentBlobView(db, ctx.chatId, node, async () => sourceMode)
  if (view.sizeBytes > OFFICE_CONVERTER_MAX_INPUT_BYTES) throw new FilesCommandError(`"${located.path}" is too large to convert`)

  const target = await destination(ctx, located.path, node.name, args)
  const mode = changeMode(await modeFor(ctx.scope, target.parentId), target.parentPath)
  const converted = await withConversionSlot(ctx.userId, async () =>
    convertOfficeDocument({ bytes: await readStoredObject(view.objectKey), from: fileExtension(node.name), to: args.to, signal: ctx.signal }))
  await assertConvertedSizeAllowed(db, converted.byteLength)
  const reply = guardedReply(ctx, mode, (executor) => modeFor(ctx.scope, target.parentId, executor))
  const created = await createBlobChange(reply, target.parentId, target.name, converted, mode, { pickFreeName: !args.output })
  const path = joinPath(target.parentPath, created.node.name)
  ctx.changed = true
  return {
    output: created.status === 'created'
      ? `Converted "${located.path}" to "${path}"`
      : `Suggested the new file "${path}", converted from "${located.path}"; it waits for the user to accept it`,
    data: { path, nodeId: created.node.id, version: created.version, status: created.status },
  }
}
