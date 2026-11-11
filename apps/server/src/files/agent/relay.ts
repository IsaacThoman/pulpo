import { z } from 'zod'
import type { RelayRequest, RelayResult } from '../../agent/controller.js'
import { truncateUtf8 } from '../../agent/output.js'
import { countFileChanges } from './changes.js'
import type { CommandContext, CommandOutput, FilesWorkspace } from './command-context.js'
import { mkdirCommand, mvCommand, rmCommand } from './edit-commands.js'
import { failureMessage } from './failures.js'
import { pullCommand } from './pull.js'
import { pushCommand } from './push.js'
import { catCommand, grepCommand, listCommand, treeCommand } from './read-commands.js'
import { loadChatFileScope, needsPermission, type FileScope } from './scope.js'

export type { FilesWorkspace } from './command-context.js'

const remotePath = z.string().max(4_096)
const localPath = z.string().min(1).max(4_096)

/** Arguments of every command, as the CLI sends them. Nothing else gets through. */
export const relayCommandArgs = {
  ls: z.strictObject({ path: remotePath.optional(), recursive: z.boolean().optional() }),
  tree: z.strictObject({ path: remotePath.optional(), depth: z.number().int().min(1).transform((depth) => Math.min(depth, 8)).optional() }),
  cat: z.strictObject({ path: remotePath }),
  grep: z.strictObject({ pattern: z.string().min(1).max(1_000), path: remotePath.optional(), ignoreCase: z.boolean().optional(), fixed: z.boolean().optional() }),
  pull: z.strictObject({ path: remotePath, dest: localPath }),
  push: z.strictObject({
    items: z.array(z.strictObject({
      local: localPath,
      remote: remotePath.min(1),
      base: z.strictObject({ nodeId: z.uuid(), version: z.string().min(1).max(200) }).nullable().default(null),
      force: z.boolean().optional(),
    })).min(1).max(200),
  }),
  mkdir: z.strictObject({ path: remotePath.min(1), parents: z.boolean().optional() }),
  mv: z.strictObject({ from: remotePath.min(1), to: remotePath.min(1) }),
  rm: z.strictObject({ path: remotePath.min(1), recursive: z.boolean().optional() }),
} satisfies Record<string, z.ZodType>

type RelayCommand = keyof typeof relayCommandArgs

const handlers: { [Command in RelayCommand]: (ctx: CommandContext, args: z.output<typeof relayCommandArgs[Command]>) => Promise<CommandOutput> } = {
  ls: listCommand,
  tree: treeCommand,
  cat: catCommand,
  grep: grepCommand,
  pull: pullCommand,
  push: pushCommand,
  mkdir: mkdirCommand,
  mv: mvCommand,
  rm: rmCommand,
}

/** The Files paths each command names, so a path needing permission is asked about before anything runs. */
const commandPaths: { [Command in RelayCommand]: (args: z.output<typeof relayCommandArgs[Command]>) => string[] } = {
  ls: (args) => [args.path ?? ''],
  tree: (args) => [args.path ?? ''],
  cat: (args) => [args.path],
  grep: (args) => [args.path ?? ''],
  pull: (args) => [args.path],
  push: (args) => args.items.map((item) => item.remote),
  mkdir: (args) => [args.path],
  mv: (args) => [args.from, args.to],
  rm: (args) => [args.path],
}

/** What came of asking the user to let this reply browse their Files. */
export type FilesPermissionOutcome = 'allowed' | 'denied' | 'expired' | 'stopped'

/** Why a command that needed permission did not get it; `unavailable`: the user cannot be asked in this reply. */
type FilesPermissionRefusal = Exclude<FilesPermissionOutcome, 'allowed'> | 'unavailable'

const REFUSED_MESSAGES: Record<FilesPermissionRefusal, string> = {
  denied: 'The user declined to let you browse their Files. Work with the items they mentioned in this chat, or ask them to mention what you need.',
  expired: 'The user did not answer your request to browse their Files in time. Carry on with what you have, and ask them in your reply if you need more from their Files.',
  stopped: 'The command was stopped',
  unavailable: 'You can only use the Files items the user mentioned in this chat: their app cannot show a request to browse the rest. If you need more, ask them in your reply to mention it.',
}

async function firstBlockedPath(scope: FileScope, paths: string[]): Promise<string | undefined> {
  for (const path of paths) if (await needsPermission(scope, path)) return path
  return undefined
}

function isRelayCommand(command: string): command is RelayCommand {
  return Object.hasOwn(relayCommandArgs, command)
}

function truncatedOutput(output: string, maxBytes: number): string {
  const kept = truncateUtf8(output, maxBytes)
  return kept === output ? output : `${kept}\n[Output truncated; pull the file or narrow the command to see the rest.]`
}

/**
 * Serves `pulpo files` commands for one agent reply. The sandbox is agent-controlled, so this
 * is the trust boundary: every request is validated, every path resolves from the chat's
 * current scope, and each change uses the access mode the user gave that part of Files.
 */
export function createFilesRelay(input: {
  userId: string
  chatId: string
  responseId: string
  workspace: FilesWorkspace
  maxOutputBytes: number
  /** After a command changed Files, with how many items the reply has changed. */
  onChanged?: (count: number) => void | Promise<void>
  /**
   * Asks the user to let this reply browse all of their Files, and waits for the answer. Without
   * it (the app that sent the message cannot show the request), such commands fail at once. A
   * refusal stands for the rest of the reply, so the agent asks once.
   */
  requestPermission?: (request: { command: string; path: string }, signal?: AbortSignal) => Promise<FilesPermissionOutcome>
}): (operationId: string, request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult> {
  let refused: 'denied' | 'expired' | undefined
  // Commands arriving while the user is being asked wait for the same answer.
  let asking: Promise<FilesPermissionOutcome> | undefined
  const askPermission = (command: string, path: string, signal?: AbortSignal): Promise<FilesPermissionOutcome | 'unavailable'> => {
    if (refused) return Promise.resolve(refused)
    if (!input.requestPermission) return Promise.resolve('unavailable')
    asking ??= input.requestPermission({ command, path }, signal).then((outcome) => {
      if (outcome === 'denied' || outcome === 'expired') refused = outcome
      return outcome
    }).finally(() => { asking = undefined })
    return asking
  }
  return async (_operationId, request, signal) => {
    const { command } = request
    if (typeof command !== 'string' || !isRelayCommand(command)) return { ok: false, error: `Unknown command "${String(command).slice(0, 40)}"; run pulpo files --help` }
    const parsed = relayCommandArgs[command].safeParse(request.args)
    if (!parsed.success) return { ok: false, error: `Invalid arguments for ${command}: ${z.prettifyError(parsed.error).slice(0, 1_000)}` }
    let ctx: CommandContext | undefined
    try {
      let scope = await loadChatFileScope(input.userId, input.chatId)
      if (!scope) return { ok: false, error: 'Files are not available in this chat' }
      const paths = (commandPaths[command] as (args: unknown) => string[])(parsed.data)
      const blocked = await firstBlockedPath(scope, paths)
      if (blocked !== undefined) {
        const outcome = await askPermission(command, blocked, signal)
        if (outcome !== 'allowed') return { ok: false, error: REFUSED_MESSAGES[outcome] }
        scope = await loadChatFileScope(input.userId, input.chatId)
        if (!scope) return { ok: false, error: 'Files are not available in this chat' }
      }
      ctx = { userId: input.userId, chatId: input.chatId, responseId: input.responseId, scope, workspace: input.workspace, signal, changed: false }
      const handler = handlers[command] as (ctx: CommandContext, args: unknown) => Promise<CommandOutput>
      const result = await handler(ctx, parsed.data)
      return { ok: true, output: truncatedOutput(result.output, input.maxOutputBytes), ...result.data === undefined ? {} : { data: result.data } }
    } catch (error) {
      return { ok: false, error: truncatedOutput(failureMessage(error), input.maxOutputBytes) }
    } finally {
      // Announcing the change is best effort; the command's answer must still reach the agent.
      if (ctx?.changed) await Promise.resolve(countFileChanges(input.responseId)).then((count) => input.onChanged?.(count)).catch(() => undefined)
    }
  }
}
