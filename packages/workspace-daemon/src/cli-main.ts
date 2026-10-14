import { rm, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { helpText, parseCli, UsageError, type Invocation } from './cli-args.js'
import { isInside, localStatus, planPush, pruneEmptyDirectories, readManifest, remotePath, sameRemote, sha256File, updateManifest, type ManifestEntry, type PushItem } from './cli-manifest.js'
import { DEFAULT_RELAY_SOCKET, OUTSIDE_AGENT_BASH, RelayUnavailableError, sendRelayRequest, type RelayAnswer } from './cli-relay.js'

export interface CliContext {
  cwd: string
  env: NodeJS.ProcessEnv
  /** Local mirror of Files (`/workspace/files`); injectable for tests. */
  mirrorRoot: string
  manifestPath: string
  stdout: (text: string) => void
  stderr: (text: string) => void
}

type Command<Name extends Invocation['command']> = Extract<Invocation, { command: Name }>
type PushStatus = 'created' | 'updated' | 'suggested' | 'unchanged' | 'conflict' | 'denied' | 'error'
interface PushResult { local: string; remote: string; status: PushStatus; message: string; nodeId?: string; version?: string }
interface PulledFile { remote: string; local: string; nodeId: string; version: string }

const SAVED: ReadonlySet<string> = new Set(['created', 'updated', 'suggested', 'unchanged'])
const PUSH_BATCH = 200

/** A refusal from Pulpo (`{ ok: false }`): the message is for the model, exit status 1. */
class CommandError extends Error {}

export function defaultContext(): CliContext {
  const workspace = resolve(process.env.PULPO_WORKSPACE_ROOT || '/workspace')
  return {
    cwd: process.cwd(), env: process.env, mirrorRoot: join(workspace, 'files'), manifestPath: join(workspace, '.pulpo', 'files.json'),
    stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text),
  }
}

const line = (text: string) => text.endsWith('\n') ? text : `${text}\n`
const print = (context: CliContext, text: string | undefined) => { if (text) context.stdout(line(text)) }
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

async function call(context: CliContext, command: string, args: Record<string, unknown>): Promise<RelayAnswer> {
  const operationId = context.env.PULPO_OPERATION_ID
  if (!operationId) throw new RelayUnavailableError(OUTSIDE_AGENT_BASH)
  const answer = await sendRelayRequest(context.env.PULPO_RELAY_SOCKET || DEFAULT_RELAY_SOCKET, operationId, command, args)
  if (!answer.ok) throw new CommandError(answer.error || 'Pulpo refused the request.')
  return answer
}

/** Runs `pulpo …` and returns the exit status: 0 ok, 1 failed, 2 bad usage. */
export async function runCli(argv: string[], context: CliContext): Promise<number> {
  let invocation: Invocation
  try { invocation = parseCli(argv) } catch (error) {
    if (!(error instanceof UsageError)) throw error
    return usage(context, error)
  }
  try {
    switch (invocation.command) {
      case 'help': context.stdout(helpText(invocation.topic)); return 0
      case 'status': return await status(context)
      case 'pull': return await pull(invocation, context)
      case 'push': return await push(invocation, context)
      case 'cat': return await each(context, 'cat', invocation.paths, (path) => ({ path }))
      case 'mkdir': return await each(context, 'mkdir', invocation.paths, (path) => ({ path, ...(invocation.parents ? { parents: true } : {}) }))
      case 'rm': return await each(context, 'rm', invocation.paths, (path) => ({ path, ...(invocation.recursive ? { recursive: true } : {}) }), (path) => forget(context, path, null))
      case 'mv': {
        const from = remotePath(invocation.from, context.mirrorRoot); const to = remotePath(invocation.to, context.mirrorRoot)
        print(context, (await call(context, 'mv', { from, to })).output)
        await forget(context, from, to)
        return 0
      }
      case 'ls': return await single(context, 'ls', { ...optionalPath(context, invocation.path), ...(invocation.recursive ? { recursive: true } : {}) })
      case 'tree': return await single(context, 'tree', { ...optionalPath(context, invocation.path), ...(invocation.depth ? { depth: invocation.depth } : {}) })
      case 'grep': return await single(context, 'grep', {
        pattern: invocation.pattern, ...optionalPath(context, invocation.path),
        ...(invocation.ignoreCase ? { ignoreCase: true } : {}), ...(invocation.fixed ? { fixed: true } : {}),
      })
    }
  } catch (error) {
    if (error instanceof UsageError) return usage(context, error)
    const message = error instanceof Error ? error.message : String(error)
    context.stderr(line(error instanceof RelayUnavailableError ? message : `pulpo files ${invocation.command}: ${message}`))
    return 1
  }
}

function usage(context: CliContext, error: UsageError): number {
  const name = error.command ? `pulpo files ${error.command}` : 'pulpo files'
  context.stderr(`${error.topLevel ? 'pulpo' : name}: ${error.message}\nRun \`${name} --help\` for usage.\n`)
  return 2
}

function optionalPath(context: CliContext, value: string | undefined): { path?: string } {
  const path = value === undefined ? '' : remotePath(value, context.mirrorRoot)
  return path ? { path } : {}
}

async function single(context: CliContext, command: string, args: Record<string, unknown>): Promise<number> {
  print(context, (await call(context, command, args)).output)
  return 0
}

/** Commands taking several paths run one request each and keep going after a failure, like coreutils. */
async function each(context: CliContext, command: string, values: string[], args: (path: string) => Record<string, unknown>, after?: (path: string) => Promise<void>): Promise<number> {
  let failed = false
  for (const value of values) {
    const path = remotePath(value, context.mirrorRoot)
    try {
      print(context, (await call(context, command, args(path))).output)
      await after?.(path)
    } catch (error) {
      if (!(error instanceof CommandError) || values.length === 1) throw error
      context.stderr(line(`pulpo files ${command}: ${error.message}`))
      failed = true
    }
  }
  return failed ? 1 : 0
}

async function pull(invocation: Command<'pull'>, context: CliContext): Promise<number> {
  const path = remotePath(invocation.path, context.mirrorRoot)
  let dest = join(context.mirrorRoot, ...path.split('/'))
  if (invocation.dest !== undefined) {
    dest = resolve(context.cwd, invocation.dest)
    // Like cp: an existing directory receives the item, unless it already holds an earlier pull of it.
    const existing = await stat(dest).catch(() => undefined)
    const manifest = await readManifest(context.manifestPath)
    const earlierPull = Object.entries(manifest.files).some(([local, entry]) => local !== dest && isInside(local, dest)
      && sameRemote(entry.remote, `${path}/${relative(dest, local).split(sep).join('/')}`))
    if (path && (invocation.dest.endsWith('/') || (existing?.isDirectory() && !earlierPull))) dest = join(dest, basename(path))
  }
  const answer = await call(context, 'pull', { path, dest })
  print(context, answer.output)
  const files = (isRecord(answer.data) && Array.isArray(answer.data.files) ? answer.data.files : []).filter((file): file is PulledFile => isRecord(file)
    && typeof file.remote === 'string' && typeof file.local === 'string' && typeof file.nodeId === 'string' && typeof file.version === 'string')
  // Hash before taking the manifest lock: a pull can bring hundreds of MiB.
  const entries: Array<[string, ManifestEntry]> = []
  for (const file of files) {
    const local = resolve(file.local)
    const sha256 = await sha256File(local).catch(() => undefined)
    if (sha256) entries.push([local, { remote: file.remote, nodeId: file.nodeId, version: file.version, sha256 }])
  }
  if (entries.length) await updateManifest(context.manifestPath, (manifest) => { for (const [local, entry] of entries) manifest.files[local] = entry })
  return 0
}

async function status(context: CliContext): Promise<number> {
  const manifest = await readManifest(context.manifestPath)
  const { modified, added, deleted, detached } = await localStatus(context.mirrorRoot, manifest)
  const list = (files: Array<{ local: string; remote: string }>) => files.map(({ local, remote }) => `  ${remote}  (${local})\n`).join('')
  if (!modified.length && !added.length && !deleted.length && !detached.length) {
    context.stdout(Object.keys(manifest.files).length ? 'No local changes.\n' : `No local changes. Nothing has been pulled yet; new files under ${context.mirrorRoot} would show here.\n`)
    return 0
  }
  if (modified.length) context.stdout(`Modified (\`pulpo files push\` saves them):\n${list(modified)}`)
  if (added.length) context.stdout(`New (\`pulpo files push\` creates them in Files):\n${list(added)}`)
  if (deleted.length) context.stdout(`Deleted locally (still in Files; \`pulpo files rm <path>\` deletes one there):\n${list(deleted)}`)
  if (detached.length) {
    context.stdout(`Moved or trashed in Files (push with --to <path>, pull the new path, or delete the copy):\n${detached
      .map(({ local, remote, to }) => `  ${remote}${to === null ? ' (trashed)' : ` (moved to "${to}")`}  (${local})\n`).join('')}`)
  }
  return 0
}

async function push(invocation: Command<'push'>, context: CliContext): Promise<number> {
  const manifest = await readManifest(context.manifestPath)
  const { items, refused } = await planPush({
    mirrorRoot: context.mirrorRoot, manifest, force: invocation.force, to: invocation.to,
    locals: invocation.locals.map((local) => resolve(context.cwd, local)),
  })
  for (const { remote, message } of refused) context.stdout(`skipped ${remote}: ${message}\n`)
  if (!items.length) {
    if (!refused.length) context.stdout(invocation.locals.length ? 'Nothing to push: those files have no changes.\n' : `Nothing to push: no modified or new files under ${context.mirrorRoot}.\n`)
    return refused.length ? 1 : 0
  }
  let failed = refused.length > 0; let conflicts = false
  for (let index = 0; index < items.length; index += PUSH_BATCH) {
    const batch = items.slice(index, index + PUSH_BATCH)
    const answer = await call(context, 'push', { items: batch.map(({ local, remote, base, force }) => ({ local, remote, base, ...(force ? { force } : {}) })) })
    const results = pushResults(answer.data)
    print(context, answer.output || results.map(({ status, remote, message }) => `${status} ${remote}${message ? `: ${message}` : ''}`).join('\n'))
    await recordPush(context, batch, results)
    for (const result of results) {
      if (!SAVED.has(result.status)) failed = true
      if (result.status === 'conflict') conflicts = true
    }
  }
  if (conflicts) context.stdout('A conflict means the item changed in Files after you pulled it. Copy your version aside, pull the item again, reapply your edits and push; or push with --force to replace it.\n')
  return failed ? 1 : 0
}

function pushResults(data: unknown): PushResult[] {
  if (!isRecord(data) || !Array.isArray(data.results)) return []
  return data.results.filter((result): result is PushResult => isRecord(result)
    && typeof result.local === 'string' && typeof result.remote === 'string' && typeof result.status === 'string')
}

async function recordPush(context: CliContext, batch: PushItem[], results: PushResult[]): Promise<void> {
  const saved = results.filter((result) => SAVED.has(result.status))
  if (!saved.length) return
  await updateManifest(context.manifestPath, (manifest) => {
    for (const result of saved) {
      const item = batch.find((candidate) => candidate.local === result.local)
      if (!item) continue
      const remote = result.remote || item.remote
      const previous = manifest.files[item.local]
      const known = previous && sameRemote(previous.remote, remote) ? previous : undefined
      const nodeId = result.nodeId ?? known?.nodeId; const version = result.version ?? known?.version
      if (nodeId && version) manifest.files[item.local] = { remote, nodeId, version, sha256: item.sha256 }
    }
  })
}

/**
 * After mv/rm the old Files path is gone. Unchanged mirror copies are removed; other copies keep
 * a tombstone so a later plain `push` reports the move instead of recreating the item.
 */
async function forget(context: CliContext, remote: string, to: string | null): Promise<void> {
  if (!remote) return
  const removed: string[] = []; const kept: string[] = []
  await updateManifest(context.manifestPath, async (manifest) => {
    for (const [local, entry] of Object.entries(manifest.files)) {
      if (!sameRemote(entry.remote, remote) && !entry.remote.toLowerCase().startsWith(`${remote.toLowerCase()}/`)) continue
      delete manifest.files[local]
      const sha256 = await sha256File(local).catch(() => undefined)
      if (!sha256) continue
      const mirrored = isInside(local, context.mirrorRoot)
      if (mirrored && sha256 === entry.sha256) { await rm(local, { force: true }); removed.push(local); continue }
      manifest.moved[local] = { remote: entry.remote, to }
      if (mirrored) kept.push(local)
    }
  })
  await pruneEmptyDirectories(removed, context.mirrorRoot)
  if (removed.length === 1) context.stdout(`Removed the local copy ${removed[0]}.\n`)
  else if (removed.length) context.stdout(`Removed ${removed.length} unchanged local copies under ${context.mirrorRoot}.\n`)
  for (const local of kept) context.stdout(`Kept ${local}: it has unpushed edits. ${to === null ? 'Push it with --to <path> to keep it, or delete it.' : 'Pull the new path, or push this copy with --to <path>.'}\n`)
}
