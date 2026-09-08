import { z } from 'zod'

export const WORKSPACE_UNRESPONSIVE_MS = 30_000
export const WORKSPACE_HEARTBEAT_MS = 5_000
export const workspaceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('pulpo') }),
  z.object({ kind: z.literal('computer'), deviceId: z.uuid(), rootId: z.uuid() }),
])
export type WorkspaceSelection = z.infer<typeof workspaceSelectionSchema>
export function resolveWorkspace(workspace: WorkspaceSelection | null | undefined, agentMode = false): WorkspaceSelection {
  return workspace ?? { kind: agentMode ? 'pulpo' : 'none' }
}
export const computerRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.enum(['darwin', 'win32']),
  stagingPath: z.string().min(1).max(4096),
  shell: z.string().min(1).max(1024),
  supportedTools: z.array(z.string().max(64)).max(30).optional(),
  roots: z.array(z.object({ id: z.uuid(), path: z.string().min(1).max(4096) })).min(1).max(20),
})
export type ComputerRegistration = z.infer<typeof computerRegistrationSchema>
export type WorkspaceComputer = ComputerRegistration & { id: string; online: boolean }
export const workspaceRecoverySchema = z.object({
  generation: z.number().int().nonnegative(),
  action: z.enum(['wait', 'switch', 'none']),
  workspace: workspaceSelectionSchema.optional(),
  acknowledgeUnknown: z.boolean().default(false),
}).refine(value => value.action !== 'switch' || !!value.workspace, { message: 'Choose a workspace' })
export type WorkspaceRecovery = z.infer<typeof workspaceRecoverySchema>
export type WorkspaceWait = {
  generation: number; reason: 'unresponsive' | 'capacity'; operationId?: string;
  startedAt: string; deadline: string; mayHaveStarted: boolean; workspace: WorkspaceSelection;
}
export type ComputerOperation = {
  id: string; generation: number; rootId: string; sessionId: string;
  reconcileOnly?: boolean; type: string; args: Record<string, unknown>; hash: string; deadline: string;
}
export const computerOperationResultSchema = z.object({
  id: z.uuid(), status: z.enum(['running', 'completed', 'failed', 'cancelled', 'unknown']),
  output: z.string().max(36_000_000), exitCode: z.number().int().nullable(), error: z.string().max(4096).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ComputerOperationResult = z.infer<typeof computerOperationResultSchema>

export const workspaceWaitSchema = z.object({
  generation: z.number().int().nonnegative(), reason: z.enum(['unresponsive', 'capacity']), operationId: z.string().optional(),
  startedAt: z.iso.datetime(), deadline: z.iso.datetime(), mayHaveStarted: z.boolean(), workspace: workspaceSelectionSchema,
})

/** Canonical JSON survives JSONB key ordering and Socket.IO serialization. */
export function workspaceOperationIdentity(type: string, args: Record<string, unknown>): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, entry]) => [key, canonical(entry)])) : value
  return JSON.stringify(canonical({ type, args }))
}
