import { computerOsLabel, type ToolImagePreview, type WorkspaceDescriptor } from '@pulpo/contracts'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentWorkspace } from './workspace.js'
import { SANDBOX_WORKSPACE_DESCRIPTOR, shellLabel } from './policy.js'
import { boundLegacyReadOutput, isBoundedReadDetails, parseAgentReadArguments, READ_MAX_LINE_LIMIT, READ_MAX_OUTPUT_BYTES } from './bounded-read.js'

const textResult = (output: string, details: unknown = {}) => ({ content: [{ type: 'text' as const, text: output }], details })
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

export const COMPUTER_SHELL_TOOL_NAME = 'shell'

interface WorkspaceToolText {
  shellToolName: string
  read: string
  readPath: string
  viewImage: string
  shell: string
  write: string
  edit: string
  ls: string
  find: string
  grep: string
  attachFile: string
}

/** Tool copy for the disposable sandbox. These strings are unchanged from before computers existed. */
const SANDBOX_TOOL_TEXT: WorkspaceToolText = {
  shellToolName: 'bash',
  read: 'Read bounded, numbered lines from a UTF-8 file anywhere in the disposable VM using normal filesystem permissions. Use bash with sudo for files requiring elevated permissions. Bare reads start at line 1 and return at most 2,000 lines or 50 KiB. Use offset and limit to page, readAll for an intentional whole-file request subject to the same 50 KiB safety cap, and grep or bash for large datasets or oversized lines.',
  readPath: 'Absolute path to a UTF-8 file anywhere in the VM, or a relative path resolved against /workspace.',
  viewImage: 'View a PNG, JPEG, GIF, or WebP image using the model\'s vision capability. Absolute paths anywhere in the disposable VM are allowed.',
  shell: 'Run a bash command in the disposable Linux workspace. Passwordless sudo is available.',
  write: 'Create or replace a UTF-8 file in the workspace.',
  edit: 'Replace one exact text occurrence in a workspace file.',
  ls: 'List files in a workspace directory.',
  find: 'Find files in the workspace.',
  grep: 'Search workspace files with ripgrep.',
  attachFile: 'Attach a completed workspace file to your response so the user can download it. Use this for files you created for the user, not for intermediate files.',
}

export function workspaceToolText(descriptor: WorkspaceDescriptor): WorkspaceToolText {
  if (descriptor.kind === 'sandbox') return SANDBOX_TOOL_TEXT
  const os = computerOsLabel(descriptor.os)
  const shell = shellLabel(descriptor)
  const folder = descriptor.accessMode === 'folder'
  const area = folder ? `the folder ${descriptor.root}` : `the user's ${os} computer`
  const scopeNote = folder
    ? `Only paths inside ${descriptor.root} or the attachments directory ${descriptor.attachmentsDir} are allowed; anything else is refused.`
    : `Relative paths resolve against ${descriptor.root}.`
  return {
    shellToolName: COMPUTER_SHELL_TOOL_NAME,
    read: `Read bounded, numbered lines from a UTF-8 file on ${area}. ${scopeNote} Bare reads start at line 1 and return at most 2,000 lines or 50 KiB. Use offset and limit to page, readAll for an intentional whole-file request subject to the same 50 KiB safety cap, and grep or shell for large datasets or oversized lines.`,
    readPath: folder
      ? `Path to a UTF-8 file inside ${descriptor.root}; relative paths resolve against that folder.`
      : `Absolute path to a UTF-8 file on the computer, or a relative path resolved against ${descriptor.root}.`,
    viewImage: `View a PNG, JPEG, GIF, or WebP image on ${area} using the model's vision capability. ${scopeNote}`,
    shell: folder
      ? `Run a ${shell} command on the user's real ${os} computer. The command starts in ${descriptor.root} and must stay inside that folder. There is no sudo or administrator access, changes are permanent, and the user may be asked to approve the command before it runs.${descriptor.shell === 'powershell' ? ' Use PowerShell syntax.' : ''}`
      : `Run a ${shell} command on the user's real ${os} computer, starting in ${descriptor.root}. There is no sudo or administrator access, changes are permanent, and the user may be asked to approve the command before it runs.${descriptor.shell === 'powershell' ? ' Use PowerShell syntax.' : ''}`,
    write: `Create or replace a UTF-8 file on ${area}. ${scopeNote} Overwrites are permanent and may require the user's approval.`,
    edit: `Replace one exact text occurrence in a file on ${area}. ${scopeNote} Edits are permanent and may require the user's approval.`,
    ls: `List files in a directory on ${area}. ${scopeNote}`,
    find: `Find files on ${area} by glob pattern. ${scopeNote}`,
    grep: `Search files on ${area} for a regular expression. ${scopeNote}`,
    attachFile: `Attach a completed file from ${folder ? descriptor.root : `the computer (inside ${descriptor.root})`} to your response so the user can download it. Use this for files you created for the user, not for intermediate files.`,
  }
}

export function createWorkspaceTools(
  manager: AgentWorkspace,
  commandTimeoutMs: number,
  onOperationStarted?: (operationId: string) => void | Promise<void>,
  onAttachFile?: (operationId: string, path: string, name: string | undefined, signal?: AbortSignal) => Promise<{ id: string; name: string; mimeType: string; sizeBytes: number }>,
  onImagePreview?: (operationId: string, path: string, data: string) => Promise<ToolImagePreview>,
  descriptor: WorkspaceDescriptor = manager?.descriptor ?? SANDBOX_WORKSPACE_DESCRIPTOR,
): AgentTool[] {
  const text = workspaceToolText(descriptor)
  const tool = (name: string, description: string, parameters: ReturnType<typeof Type.Object>, execute: AgentTool['execute']): AgentTool => ({ name, label: name, description, parameters, executionMode: 'sequential', execute })
  const started = (operationId: string) => () => onOperationStarted?.(operationId)
  return [
    tool('read', text.read, Type.Object({
      path: Type.String({ description: text.readPath }),
      offset: Type.Optional(Type.Integer({ minimum: 1, description: 'One-based line number at which to start reading.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: READ_MAX_LINE_LIMIT, description: 'Maximum lines to return; defaults to 2,000.' })),
      readAll: Type.Optional(Type.Boolean({ description: 'Request the whole file when small enough; cannot be combined with offset or limit and never bypasses the 50 KiB cap.' })),
    }, { additionalProperties: false }), async (id, rawArgs, signal) => {
      const args = record(rawArgs)
      if (typeof args.path !== 'string' || !args.path.trim()) throw new Error('path must be a non-empty string')
      parseAgentReadArguments(args)
      const operation = await manager.execute(id, 'read', args, signal, undefined, started(id))
      const bounded = isBoundedReadDetails(operation.details)
      if (bounded && Buffer.byteLength(operation.output, 'utf8') > READ_MAX_OUTPUT_BYTES) {
        throw new Error('Workspace read exceeded the 50 KiB safety limit')
      }
      const result = bounded ? { output: operation.output, details: operation.details } : boundLegacyReadOutput(operation.output, args)
      return textResult(result.output, result.details)
    }),
    tool('view_image', text.viewImage, Type.Object({ path: Type.String() }), async (id, args, signal) => {
      const path = String(record(args).path ?? '')
      const viewed = await manager.viewImage(path, signal, started(id))
      let imagePreview: ToolImagePreview | undefined
      if (onImagePreview) {
        try {
          imagePreview = await onImagePreview(id, path, viewed.data)
        } catch (error) {
          console.warn('Agent image preview unavailable', { operationId: id, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return {
        content: [
          { type: 'text' as const, text: `Viewed ${path} (${viewed.mimeType}, ${viewed.sizeBytes} bytes)` },
          { type: 'image' as const, data: viewed.data, mimeType: viewed.mimeType },
        ],
        details: { path, mimeType: viewed.mimeType, sizeBytes: viewed.sizeBytes, ...(imagePreview ? { imagePreview } : {}) },
      }
    }),
    tool(text.shellToolName, text.shell, Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()), timeoutMs: Type.Optional(Type.Number()) }), async (id, args, signal, onUpdate) => {
      const values = record(args)
      const result = await manager.execute(id, 'bash', { ...values, timeoutMs: Math.min(Number(values.timeoutMs ?? commandTimeoutMs), commandTimeoutMs) }, signal, (output) => onUpdate?.(textResult(output)), async () => {
        await onOperationStarted?.(id)
        onUpdate?.(textResult('Command started…'))
      })
      return textResult(result.output, { exitCode: result.exitCode })
    }),
    tool('write', text.write, Type.Object({ path: Type.String(), content: Type.String() }), async (id, args, signal) => textResult((await manager.execute(id, 'write', record(args), signal, undefined, started(id))).output)),
    tool('edit', text.edit, Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }), async (id, args, signal) => textResult((await manager.execute(id, 'edit', record(args), signal, undefined, started(id))).output)),
    tool('ls', text.ls, Type.Object({ path: Type.Optional(Type.String()) }), async (id, args, signal) => textResult((await manager.execute(id, 'list', record(args), signal, undefined, started(id))).output)),
    tool('find', text.find, Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }), async (id, args, signal) => textResult((await manager.execute(id, 'find', record(args), signal, undefined, started(id))).output)),
    tool('grep', text.grep, Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }), async (id, args, signal) => textResult((await manager.execute(id, 'grep', record(args), signal, undefined, started(id))).output)),
    tool('attach_file', text.attachFile, Type.Object({ path: Type.String(), name: Type.Optional(Type.String()) }), async (id, args, signal) => {
      if (!onAttachFile) throw new Error('File attachments are unavailable')
      const values = record(args)
      const attachment = await onAttachFile(id, String(values.path ?? ''), typeof values.name === 'string' ? values.name : undefined, signal)
      return textResult(`Attached ${attachment.name} (${attachment.sizeBytes} bytes)`, { attachment })
    }),
  ]
}
