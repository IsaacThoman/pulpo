import { eq } from 'drizzle-orm'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'
import { FILE_DOC_MAX_MARKDOWN_LENGTH, isMarkdownName } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { applicationSettings } from '../../database/schema.js'
import { parseAuthSettings } from '../../settings/application-settings.js'
import type { FileNodeRow } from '../access.js'
import { readOnlyMessage, workspacePath, type CommandContext, type CommandOutput } from './command-context.js'
import { createBlobChange, createDocChange, updateBlobChange, updateDocChange, type ContentResult } from './mutations.js'
import { failureMessage } from './failures.js'
import { FilesCommandError, locateParent, locateOptional, modeFor } from './scope.js'
import { agentBlobView, blobVersion, contentChecksum } from './versions.js'

/** The daemon exports at most this much per file. */
const WORKSPACE_FILE_MAX_BYTES = 25 * 1024 * 1024
/** All files one push may read from the workspace. */
const PUSH_MAX_BYTES = 500 * 1024 * 1024
/** UTF-8 needs at most four bytes per character. */
const DOC_MAX_BYTES = Math.min(FILE_DOC_MAX_MARKDOWN_LENGTH * 4, WORKSPACE_FILE_MAX_BYTES)

export interface PushItem {
  local: string
  remote: string
  base: { nodeId: string; version: string } | null
  force?: boolean
}

export type PushStatus = 'created' | 'updated' | 'suggested' | 'unchanged' | 'conflict' | 'denied' | 'error'

export interface PushResult {
  local: string
  remote: string
  status: PushStatus
  message: string
  nodeId?: string
  version?: string
}

type Outcome = Omit<PushResult, 'local' | 'remote'>

interface PushLimits {
  fileBytes: number
  remainingBytes: number
}

async function readLocal(ctx: CommandContext, local: string, maxBytes: number, limits: PushLimits, limitNote = ''): Promise<Uint8Array> {
  if (limits.remainingBytes <= 0) throw new FilesCommandError('This push already read 500 MB; push the remaining files separately')
  let bytes: Uint8Array
  try {
    bytes = await ctx.workspace.readWorkspaceFile(local, Math.min(maxBytes, limits.remainingBytes), ctx.signal)
  } catch (error) {
    throw new FilesCommandError(`Could not read "${local}"${limitNote}: ${error instanceof Error ? error.message : String(error)}`)
  }
  limits.remainingBytes -= bytes.byteLength
  return bytes
}

async function readMarkdown(ctx: CommandContext, local: string, limits: PushLimits): Promise<string> {
  const bytes = await readLocal(ctx, local, DOC_MAX_BYTES, limits)
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    throw new FilesCommandError('Markdown documents must be UTF-8 text')
  }
  if (markdown.length > FILE_DOC_MAX_MARKDOWN_LENGTH) throw new FilesCommandError(`Documents can hold at most ${FILE_DOC_MAX_MARKDOWN_LENGTH.toLocaleString('en')} characters`)
  return markdown
}

async function readUpload(ctx: CommandContext, local: string, limits: PushLimits): Promise<Uint8Array> {
  return readLocal(ctx, local, limits.fileBytes, limits, ` (uploaded files can be at most ${formatAttachmentSizeLimit(limits.fileBytes)})`)
}

function conflict(path: string, version?: string): Outcome {
  return {
    status: 'conflict', version,
    message: `"${path}" changed in Files since you pulled it. Pull it again, redo your change on the new version, and push; push with --force only to overwrite the user's changes`,
  }
}

function contentOutcome(result: ContentResult, path: string, nodeId: string): Outcome {
  const { status, version } = result
  if (status === 'conflict') return { ...conflict(path, version), nodeId }
  const messages = {
    updated: `Saved "${path}"`,
    suggested: result.hunks === undefined
      ? `Suggested new content for "${path}"; it waits for the user to accept it`
      : result.hunks
        ? `Suggested ${result.hunks} change${result.hunks === 1 ? '' : 's'} to "${path}"; they wait for the user to accept them`
        : `Revised your suggested changes to "${path}"; they wait for the user to accept them`,
    unchanged: `"${path}" already has this content`,
  }
  return { status, message: messages[status], nodeId, version }
}

async function pushExisting(ctx: CommandContext, node: FileNodeRow, path: string, local: string, item: PushItem, limits: PushLimits): Promise<Outcome> {
  const mode = await modeFor(ctx.scope, node.id)
  if (mode !== 'write' && mode !== 'suggest') return { status: 'denied', message: readOnlyMessage(path), nodeId: node.id }
  if (node.kind === 'folder') throw new FilesCommandError(`"${path}" is a folder; push the files inside it`)
  if (!item.force) {
    if (!item.base) return { status: 'conflict', nodeId: node.id, message: `"${path}" already exists in Files. Pull it, make your change, and push; push with --force only to replace it` }
    if (item.base.nodeId !== node.id) return { status: 'conflict', nodeId: node.id, message: `"${path}" is now a different item than the one you pulled; pull it again` }
  }
  const expected = item.force ? null : item.base!.version
  if (node.kind === 'doc') {
    const markdown = await readMarkdown(ctx, local, limits)
    return contentOutcome(await updateDocChange(ctx, node.id, markdown, mode, expected), path, node.id)
  }
  // Settle what can be settled before storing a copy of the bytes.
  const view = await agentBlobView(db, ctx.chatId, node)
  if (expected !== null && blobVersion(view) !== expected) return { ...conflict(path, blobVersion(view)), nodeId: node.id }
  const bytes = await readUpload(ctx, local, limits)
  if (contentChecksum(bytes) === view.checksum) return contentOutcome({ status: 'unchanged', version: blobVersion(view) }, path, node.id)
  return contentOutcome(await updateBlobChange(ctx, node, bytes, mode, expected), path, node.id)
}

async function pushNew(ctx: CommandContext, local: string, item: PushItem, limits: PushLimits): Promise<Outcome> {
  if (item.base && !item.force) {
    return {
      status: 'conflict',
      message: `"${item.remote}" is no longer in Files: it was moved, renamed, or deleted. List its folder to find it, or push with --force to add it again`,
    }
  }
  const { parent, name, path } = await locateParent(ctx.scope, item.remote)
  const mode = await modeFor(ctx.scope, parent.node?.id ?? null)
  if (mode !== 'write' && mode !== 'suggest') return { status: 'denied', message: readOnlyMessage(parent.path) }
  const created = isMarkdownName(name)
    ? await createDocChange(ctx, parent.node?.id ?? null, name, await readMarkdown(ctx, local, limits), mode)
    : await createBlobChange(ctx, parent.node?.id ?? null, name, await readUpload(ctx, local, limits), mode)
  const message = created.status === 'created' ? `Created "${path}"` : `Suggested the new file "${path}"; it waits for the user to accept it`
  return { status: created.status, message, nodeId: created.node.id, version: created.version }
}

async function pushOne(ctx: CommandContext, item: PushItem, limits: PushLimits): Promise<PushResult> {
  const result = { local: item.local, remote: item.remote }
  try {
    const local = workspacePath(item.local)
    const located = await locateOptional(ctx.scope, item.remote)
    if (located && !located.node) throw new FilesCommandError('Give the path of a file, not the top of My files')
    const outcome = located?.node
      ? await pushExisting(ctx, located.node, located.path, local, item, limits)
      : await pushNew(ctx, local, item, limits)
    if (outcome.status === 'created' || outcome.status === 'updated' || outcome.status === 'suggested') ctx.changed = true
    return { ...result, ...outcome }
  } catch (error) {
    return { ...result, status: 'error', message: failureMessage(error) }
  }
}

async function maxFileBytes(): Promise<number> {
  const [setting] = await db.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
  return Math.min(parseAuthSettings(setting?.value).maxAttachmentBytes, WORKSPACE_FILE_MAX_BYTES)
}

/**
 * `push`: saves workspace files into Files, each checked against the version the agent pulled
 * (unless forced) and applied in the mode its place in Files allows. One item's failure does
 * not stop the others.
 */
export async function pushCommand(ctx: CommandContext, args: { items: PushItem[] }): Promise<CommandOutput> {
  const limits = { fileBytes: await maxFileBytes(), remainingBytes: PUSH_MAX_BYTES }
  const results: PushResult[] = []
  for (const item of args.items) {
    ctx.signal?.throwIfAborted()
    results.push(await pushOne(ctx, item, limits))
  }
  return { output: results.map((result) => `${result.status}: ${result.message}`).join('\n'), data: { results } }
}
