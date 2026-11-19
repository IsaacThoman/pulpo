import { z } from 'zod'
import { COMPUTER_PATH_MAX_LENGTH, type ComputerFolderMode } from '@pulpo/contracts'
import type { RelayRequest, RelayResult } from '../agent/controller.js'
import { truncateUtf8 } from '../agent/output.js'
import type { FilesWorkspace } from '../files/agent/command-context.js'
import { catCommand, grepCommand, listCommand, mkdirCommand, mvCommand, rmCommand, treeCommand, type FolderContext, type FolderOutput } from './folder-commands.js'
import { folderName, FolderCommandError } from './folder-paths.js'
import { pullCommand, pushCommand } from './folder-transfer.js'
import { ComputerRequestError, ComputerUnavailableError, type ComputerSessionRef } from './tunnel.js'

export { describeComputerFolder } from './folder-prompt.js'

/** `pulpo computer <command>` reaches the server as a relay request named with this prefix, e.g. `computer:ls`. */
export const COMPUTER_RELAY_PREFIX = 'computer:'

export function isComputerRelayCommand(command: unknown): boolean {
  return typeof command === 'string' && command.startsWith(COMPUTER_RELAY_PREFIX)
}

export interface ComputerFolderRelayInput {
  session: ComputerSessionRef
  responseId: string
  /** What the user allowed in the folder; the desktop app enforces it too. */
  mode: ComputerFolderMode
  /** The folder's absolute path on the user's computer, for messages only. */
  folder: string
  /** The cloud workspace `pull` writes into and `push` reads from. */
  workspace: FilesWorkspace
  maxOutputBytes: number
  /** After a command changed, or suggested changes to, the folder: the reply's totals so far. */
  onChanged?: (totals: { applied: number; suggested: number }) => void | Promise<void>
}

const remotePath = z.string().max(COMPUTER_PATH_MAX_LENGTH)
const localPath = z.string().min(1).max(4_096)

/** Arguments of every command, as the CLI sends them; the same as `pulpo files`, except that a file's id is its path. */
export const computerRelayCommandArgs = {
  ls: z.strictObject({ path: remotePath.optional(), recursive: z.boolean().optional() }),
  tree: z.strictObject({ path: remotePath.optional(), depth: z.number().int().min(1).transform((depth) => Math.min(depth, 8)).optional() }),
  cat: z.strictObject({ path: remotePath }),
  grep: z.strictObject({ pattern: z.string().min(1).max(1_000), path: remotePath.optional(), ignoreCase: z.boolean().optional(), fixed: z.boolean().optional() }),
  pull: z.strictObject({ path: remotePath, dest: localPath }),
  push: z.strictObject({
    items: z.array(z.strictObject({
      local: localPath,
      remote: remotePath.min(1),
      base: z.strictObject({ nodeId: remotePath.min(1), version: z.string().min(1).max(200) }).nullable().default(null),
      force: z.boolean().optional(),
    })).min(1).max(200),
  }),
  mkdir: z.strictObject({ path: remotePath.min(1), parents: z.boolean().optional() }),
  mv: z.strictObject({ from: remotePath.min(1), to: remotePath.min(1) }),
  rm: z.strictObject({ path: remotePath.min(1), recursive: z.boolean().optional() }),
} satisfies Record<string, z.ZodType>

type FolderCommand = keyof typeof computerRelayCommandArgs

const handlers: { [Command in FolderCommand]: (ctx: FolderContext, args: z.output<typeof computerRelayCommandArgs[Command]>) => Promise<FolderOutput> } = {
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

const isFolderCommand = (command: string): command is FolderCommand => Object.hasOwn(computerRelayCommandArgs, command)

const UNAVAILABLE_MESSAGE = 'The user\'s computer is not connected to Pulpo right now, so the shared folder cannot be reached. Tell the user to keep the Pulpo desktop app open and signed in, then try again.'

function truncatedOutput(output: string, maxBytes: number): string {
  const kept = truncateUtf8(output, maxBytes)
  return kept === output ? output : `${kept}\n[Output truncated; pull the file or narrow the command to see the rest.]`
}

/** What the agent is told when a command fails; anything unexpected is logged and stays generic. */
function failureMessage(error: unknown, signal?: AbortSignal): string {
  if (error instanceof ComputerUnavailableError) return UNAVAILABLE_MESSAGE
  if (error instanceof ComputerRequestError || error instanceof FolderCommandError) return error.message
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return 'The command was stopped'
  console.error(JSON.stringify({ level: 'error', event: 'computer.folder_command_failed', error: error instanceof Error ? error.message : String(error) }))
  return 'Pulpo could not complete this; try again'
}

/**
 * Serves `pulpo computer` commands for one agent reply against the folder the user shared from
 * their computer. Like the Files relay, this is a trust boundary: the sandbox is agent-controlled.
 */
export function createComputerFolderRelay(input: ComputerFolderRelayInput): (operationId: string, request: RelayRequest, signal?: AbortSignal) => Promise<RelayResult> {
  // Each path counts once for the reply, however many commands touched it.
  const applied = new Set<string>()
  const suggested = new Set<string>()
  const name = folderName(input.folder)
  return async (_operationId, request, signal) => {
    const command = isComputerRelayCommand(request.command) ? request.command.slice(COMPUTER_RELAY_PREFIX.length) : ''
    if (!isFolderCommand(command)) return { ok: false, error: `Unknown command "${String(request.command).slice(0, 40)}"; run pulpo computer --help` }
    const parsed = computerRelayCommandArgs[command].safeParse(request.args)
    if (!parsed.success) return { ok: false, error: `Invalid arguments for ${command}: ${z.prettifyError(parsed.error).slice(0, 1_000)}` }
    const ctx: FolderContext = {
      session: input.session, responseId: input.responseId, mode: input.mode, name, workspace: input.workspace,
      maxOutputBytes: input.maxOutputBytes, signal, changes: { applied: new Set(), suggested: new Set() },
    }
    try {
      const handler = handlers[command] as (ctx: FolderContext, args: unknown) => Promise<FolderOutput>
      const result = await handler(ctx, parsed.data)
      return { ok: true, output: truncatedOutput(result.output, input.maxOutputBytes), ...result.data === undefined ? {} : { data: result.data } }
    } catch (error) {
      return { ok: false, error: truncatedOutput(failureMessage(error, signal), input.maxOutputBytes) }
    } finally {
      if (ctx.changes.applied.size || ctx.changes.suggested.size) {
        for (const path of ctx.changes.applied) applied.add(path)
        for (const path of ctx.changes.suggested) suggested.add(path)
        // Announcing the change is best effort; the command's answer must still reach the agent.
        await Promise.resolve().then(() => input.onChanged?.({ applied: applied.size, suggested: suggested.size })).catch(() => undefined)
      }
    }
  }
}
