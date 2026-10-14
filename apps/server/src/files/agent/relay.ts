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
import { loadChatFileScope } from './scope.js'

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
}): (operationId: string, request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult> {
  return async (_operationId, request, signal) => {
    const { command } = request
    if (typeof command !== 'string' || !isRelayCommand(command)) return { ok: false, error: `Unknown command "${String(command).slice(0, 40)}"; run pulpo files --help` }
    const parsed = relayCommandArgs[command].safeParse(request.args)
    if (!parsed.success) return { ok: false, error: `Invalid arguments for ${command}: ${z.prettifyError(parsed.error).slice(0, 1_000)}` }
    let ctx: CommandContext | undefined
    try {
      const scope = await loadChatFileScope(input.userId, input.chatId)
      if (!scope) return { ok: false, error: 'Files are not available in this chat' }
      if (!scope.roots.length) return { ok: false, error: 'Nothing from Files is attached to this chat. The user can attach items with "Add from Files…" in the composer\'s + menu' }
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
