import {
  COMPUTER_INLINE_MAX_BYTES, COMPUTER_PULL_MAX_BYTES, COMPUTER_PULL_MAX_FILE_BYTES, COMPUTER_PULL_MAX_FILES, COMPUTER_PUSH_MAX_FILE_BYTES,
  computerTransferTimeoutMs, type ComputerFolderChangeResult, type ComputerFolderEntry,
} from '@pulpo/contracts'
import { readOnlyMessage, skippedNote, type FolderContext, type FolderOutput } from './folder-commands.js'
import { folderPath, FolderCommandError, formatSize, isFolderPath, isWithin, localPath } from './folder-paths.js'
import { computerCall, ComputerRequestError, createComputerDownload, createComputerUpload } from './tunnel.js'

/** Files moved at once: enough to hide the round trips, few enough not to flood the user's connection. */
const TRANSFER_CONCURRENCY = 4
/** All files one push may read from the workspace, as for Files. */
const PUSH_MAX_BYTES = 500 * 1024 * 1024
const PULL_LISTED = 50

/** What the CLI's manifest records; `nodeId` is the path in the folder and `version` the SHA-256 the desktop app computed. */
export interface PulledFile { remote: string; local: string; nodeId: string; version: string; sizeBytes: number }

export type PushStatus = ComputerFolderChangeResult['status']
export interface PushItem { local: string; remote: string; base: { nodeId: string; version: string } | null; force?: boolean }
export interface PushResult { local: string; remote: string; status: PushStatus; message: string; nodeId?: string; version?: string }

/** Runs `task` over `items`, a few at a time, stopping at the first failure. Results keep the items' order. */
async function eachLimited<T, R>(items: T[], signal: AbortSignal | undefined, task: (item: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const stop = new AbortController()
  const combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal
  const results: R[] = new Array(items.length)
  let next = 0
  let failure: { error: unknown } | undefined
  const worker = async () => {
    while (!failure && next < items.length) {
      const index = next++
      try {
        combined.throwIfAborted()
        results[index] = await task(items[index]!, combined)
      } catch (error) {
        failure ??= { error }
        stop.abort(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRANSFER_CONCURRENCY, items.length) }, worker))
  if (failure) throw signal?.aborted ? signal.reason ?? failure.error : failure.error
  return results
}

async function writeLocal(ctx: FolderContext, local: string, body: Uint8Array | NodeJS.ReadableStream, sizeBytes: number, signal: AbortSignal): Promise<void> {
  try {
    await ctx.workspace.writeWorkspaceFile(local, body, sizeBytes, signal)
  } catch (error) {
    if (signal.aborted) throw error
    throw new FolderCommandError(`Could not write "${local}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Copies one file from the user's computer into the workspace. */
async function pullFile(ctx: FolderContext, entry: ComputerFolderEntry, local: string, signal: AbortSignal): Promise<PulledFile> {
  // A big file on a home uplink takes a while: the request and its URL are given time by size.
  const timeoutMs = computerTransferTimeoutMs(entry.sizeBytes)
  const upload = await createComputerUpload(ctx.session, { maxBytes: COMPUTER_PULL_MAX_FILE_BYTES, ttlMs: timeoutMs + 60_000 })
  try {
    const sent = await computerCall(ctx.session, 'folder.send', { path: entry.path, transfer: upload.transfer, maxBytes: COMPUTER_PULL_MAX_FILE_BYTES }, { timeoutMs, signal })
    if (sent.data !== undefined) {
      const bytes = Buffer.from(sent.data, 'base64')
      await writeLocal(ctx, local, bytes, bytes.byteLength, signal)
      return { remote: entry.path, local, nodeId: entry.path, version: sent.version, sizeBytes: bytes.byteLength }
    }
    const { stream, sizeBytes } = await upload.open()
    try {
      if (sizeBytes > COMPUTER_PULL_MAX_FILE_BYTES) throw new FolderCommandError(`"${entry.path}" is larger than ${formatSize(COMPUTER_PULL_MAX_FILE_BYTES)}`)
      await writeLocal(ctx, local, stream, sizeBytes, signal)
    } finally {
      // Releases the stored upload when the write stopped early.
      stream.destroy()
    }
    return { remote: entry.path, local, nodeId: entry.path, version: sent.version, sizeBytes }
  } finally {
    await upload.dispose().catch(() => undefined)
  }
}

/**
 * `pull <path> <dest>`: copies a file, or every file in a folder (without .git and node_modules),
 * into the workspace. `data.files` is what the CLI's manifest records.
 */
export async function pullCommand(ctx: FolderContext, args: { path: string; dest: string }): Promise<FolderOutput> {
  const path = folderPath(args.path)
  const destination = localPath(args.dest)
  const shown = path || ctx.name
  const planned = await computerCall(ctx.session, 'folder.list', { path, depth: 64, limit: COMPUTER_PULL_MAX_FILES + 1, filesOnly: true }, { signal: ctx.signal })
  const single = path !== '' && planned.entries.length === 1 && planned.entries[0]!.path === path
  const entries = planned.entries.filter((entry) => entry.kind === 'file')
  if (planned.truncated || entries.length > COMPUTER_PULL_MAX_FILES) {
    throw new FolderCommandError(`"${shown}" holds more than ${COMPUTER_PULL_MAX_FILES} files; pull the folders inside it one at a time`)
  }
  const items: Array<{ entry: ComputerFolderEntry; local: string }> = []
  for (const entry of entries) {
    // The desktop app lists only below `path`, but the answer decides where bytes are written.
    if (!isFolderPath(entry.path) || !isWithin(entry.path, path) || (!single && entry.path === path)) {
      throw new FolderCommandError(`The user's computer listed "${entry.path}", which is not inside "${shown}"`)
    }
    if (entry.sizeBytes > COMPUTER_PULL_MAX_FILE_BYTES) throw new FolderCommandError(`"${entry.path}" is larger than ${formatSize(COMPUTER_PULL_MAX_FILE_BYTES)}; it cannot be pulled`)
    items.push({ entry, local: single ? destination : localPath(`${destination}/${path ? entry.path.slice(path.length + 1) : entry.path}`) })
  }
  if (!single && items.reduce((total, item) => total + item.entry.sizeBytes, 0) > COMPUTER_PULL_MAX_BYTES) {
    throw new FolderCommandError(`"${shown}" is larger than ${formatSize(COMPUTER_PULL_MAX_BYTES)}; pull the folders inside it one at a time`)
  }
  const files = await eachLimited(items, ctx.signal, (item, signal) => pullFile(ctx, item.entry, item.local, signal))
  const what = single ? `"${path}"` : `${files.length} file${files.length === 1 ? '' : 's'} from "${shown}"`
  const listed = files.length > 1 ? files.slice(0, PULL_LISTED).map((file) => `  ${file.local}`) : []
  if (files.length > PULL_LISTED) listed.push(`  … and ${files.length - PULL_LISTED} more`)
  const summary = files.length ? `Pulled ${what} into ${destination}` : `"${shown}" has no files to pull`
  return { output: [summary, ...listed, ...skippedNote(planned.skipped)].join('\n'), data: { files } }
}

const DEFAULT_MESSAGES: Record<PushStatus, (path: string) => string> = {
  created: (path) => `Created "${path}"`,
  updated: (path) => `Saved "${path}"`,
  suggested: (path) => `Suggested new content for "${path}"; it waits for the user to accept it`,
  unchanged: (path) => `"${path}" already has this content`,
  conflict: (path) => `"${path}" changed on the user's computer since you pulled it. Pull it again, redo your change on the new version, and push; push with --force only to overwrite the user's changes`,
  denied: (path) => `"${path}" cannot be changed`,
  error: (path) => `The user's computer could not save "${path}"`,
}

async function pushOne(ctx: FolderContext, item: PushItem, budget: { remainingBytes: number }): Promise<PushResult> {
  const result = { local: item.local, remote: item.remote }
  let remote: string
  let local: string
  try {
    remote = folderPath(item.remote)
    if (!remote) throw new FolderCommandError('Give the path of a file, not the shared folder itself')
    local = localPath(item.local)
  } catch (error) {
    if (error instanceof FolderCommandError) return { ...result, status: 'error', message: error.message }
    throw error
  }
  if (budget.remainingBytes <= 0) return { ...result, remote, status: 'error', message: 'This push already read 500 MB; push the remaining files separately' }
  let bytes: Uint8Array
  try {
    bytes = await ctx.workspace.readWorkspaceFile(local, Math.min(COMPUTER_PUSH_MAX_FILE_BYTES, budget.remainingBytes), ctx.signal)
  } catch (error) {
    if (ctx.signal?.aborted) throw error
    return { ...result, remote, status: 'error', message: `Could not read "${local}" (files can be at most ${formatSize(COMPUTER_PUSH_MAX_FILE_BYTES)}): ${error instanceof Error ? error.message : String(error)}` }
  }
  budget.remainingBytes -= bytes.byteLength
  const inline = bytes.byteLength <= COMPUTER_INLINE_MAX_BYTES
  const download = inline ? undefined : await createComputerDownload(ctx.session, bytes, bytes.byteLength)
  try {
    const answer = await computerCall(ctx.session, 'folder.change', {
      responseId: ctx.responseId,
      change: {
        kind: 'put', path: remote, sizeBytes: bytes.byteLength,
        // The desktop app compares the file's current SHA-256 with the one the agent pulled.
        base: item.force ? null : item.base?.version ?? null,
        ...item.force ? { force: true } : {},
        ...download ? { transfer: download.transfer } : { data: Buffer.from(bytes).toString('base64') },
      },
    }, { signal: ctx.signal, ...download ? { timeoutMs: computerTransferTimeoutMs(bytes.byteLength) } : {} })
    if (answer.status === 'created' || answer.status === 'updated') ctx.changes.applied.add(remote)
    if (answer.status === 'suggested') ctx.changes.suggested.add(remote)
    const saved = answer.status === 'created' || answer.status === 'updated' || answer.status === 'suggested'
    return {
      ...result, remote, status: answer.status, nodeId: remote,
      message: saved || !answer.message ? DEFAULT_MESSAGES[answer.status](remote) : answer.message,
      ...answer.version === undefined ? {} : { version: answer.version },
    }
  } catch (error) {
    if (error instanceof ComputerRequestError) return { ...result, remote, status: 'error', message: error.message }
    throw error
  } finally {
    await download?.dispose().catch(() => undefined)
  }
}

/**
 * `push`: saves workspace files into the shared folder, each checked by the desktop app against
 * the version the agent pulled (unless forced). One item's failure does not stop the others;
 * losing the computer does.
 */
export async function pushCommand(ctx: FolderContext, args: { items: PushItem[] }): Promise<FolderOutput> {
  let results: PushResult[]
  if (ctx.mode === 'read') {
    results = args.items.map((item) => ({ local: item.local, remote: item.remote, status: 'denied', message: readOnlyMessage(ctx) }))
  } else {
    const budget = { remainingBytes: PUSH_MAX_BYTES }
    results = []
    for (const item of args.items) {
      ctx.signal?.throwIfAborted()
      results.push(await pushOne(ctx, item, budget))
    }
  }
  return { output: results.map((result) => `${result.status}: ${result.message}`).join('\n'), data: { results } }
}
