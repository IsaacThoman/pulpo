import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { WorkspaceManager } from './controller.js'

const textResult = (output: string, details: unknown = {}) => ({ content: [{ type: 'text' as const, text: output }], details })
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

export function createWorkspaceTools(
  manager: WorkspaceManager,
  commandTimeoutMs: number,
  onOperationStarted?: (operationId: string) => void | Promise<void>,
  onAttachFile?: (operationId: string, path: string, name: string | undefined, signal?: AbortSignal) => Promise<{ id: string; name: string; mimeType: string; sizeBytes: number }>,
): AgentTool[] {
  const tool = (name: string, description: string, parameters: ReturnType<typeof Type.Object>, execute: AgentTool['execute']): AgentTool => ({ name, label: name, description, parameters, executionMode: 'sequential', execute })
  const started = (operationId: string) => () => onOperationStarted?.(operationId)
  return [
    tool('read', 'Read a UTF-8 file from the Linux workspace.', Type.Object({ path: Type.String() }), async (id, args, signal) => textResult((await manager.execute(id, 'read', record(args), signal, undefined, started(id))).output)),
    tool('view_image', 'View a PNG, JPEG, GIF, or WebP image using the model\'s vision capability. Absolute paths anywhere in the disposable VM are allowed.', Type.Object({ path: Type.String() }), async (id, args, signal) => {
      const path = String(record(args).path ?? '')
      const viewed = await manager.viewImage(path, signal, started(id))
      return {
        content: [
          { type: 'text' as const, text: `Viewed ${path} (${viewed.mimeType}, ${viewed.sizeBytes} bytes)` },
          { type: 'image' as const, data: viewed.data, mimeType: viewed.mimeType },
        ],
        details: { path, mimeType: viewed.mimeType, sizeBytes: viewed.sizeBytes },
      }
    }),
    tool('bash', 'Run a bash command in the disposable Linux workspace. Passwordless sudo is available.', Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()), timeoutMs: Type.Optional(Type.Number()) }), async (id, args, signal, onUpdate) => {
      const values = record(args)
      const result = await manager.execute(id, 'bash', { ...values, timeoutMs: Math.min(Number(values.timeoutMs ?? commandTimeoutMs), commandTimeoutMs) }, signal, (output) => onUpdate?.(textResult(output)), async () => {
        await onOperationStarted?.(id)
        onUpdate?.(textResult('Command started…'))
      })
      return textResult(result.output, { exitCode: result.exitCode })
    }),
    tool('write', 'Create or replace a UTF-8 file in the workspace.', Type.Object({ path: Type.String(), content: Type.String() }), async (id, args, signal) => textResult((await manager.execute(id, 'write', record(args), signal, undefined, started(id))).output)),
    tool('edit', 'Replace one exact text occurrence in a workspace file.', Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }), async (id, args, signal) => textResult((await manager.execute(id, 'edit', record(args), signal, undefined, started(id))).output)),
    tool('ls', 'List files in a workspace directory.', Type.Object({ path: Type.Optional(Type.String()) }), async (id, args, signal) => textResult((await manager.execute(id, 'list', record(args), signal, undefined, started(id))).output)),
    tool('find', 'Find files in the workspace.', Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }), async (id, args, signal) => textResult((await manager.execute(id, 'find', record(args), signal, undefined, started(id))).output)),
    tool('grep', 'Search workspace files with ripgrep.', Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }), async (id, args, signal) => textResult((await manager.execute(id, 'grep', record(args), signal, undefined, started(id))).output)),
    tool('attach_file', 'Attach a completed workspace file to your response so the user can download it. Use this for files you created for the user, not for intermediate files.', Type.Object({ path: Type.String(), name: Type.Optional(Type.String()) }), async (id, args, signal) => {
      if (!onAttachFile) throw new Error('File attachments are unavailable')
      const values = record(args)
      const attachment = await onAttachFile(id, String(values.path ?? ''), typeof values.name === 'string' ? values.name : undefined, signal)
      return textResult(`Attached ${attachment.name} (${attachment.sizeBytes} bytes)`, { attachment })
    }),
  ]
}
