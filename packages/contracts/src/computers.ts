import { z } from 'zod'

const idSchema = z.uuid()
const isoDateSchema = z.iso.datetime()

export const computerOsSchema = z.enum(['macos', 'windows', 'linux'])
export type ComputerOs = z.infer<typeof computerOsSchema>
export const computerAccessModeSchema = z.enum(['folder', 'full'])
export type ComputerAccessMode = z.infer<typeof computerAccessModeSchema>
export const computerApprovalPolicySchema = z.enum(['default', 'bash-only', 'never'])
export type ComputerApprovalPolicy = z.infer<typeof computerApprovalPolicySchema>
export const computerShellSchema = z.enum(['bash', 'powershell'])
export type ComputerShell = z.infer<typeof computerShellSchema>
export const computerPairingStatusSchema = z.enum(['pending', 'approved', 'denied', 'revoked'])
export type ComputerPairingStatus = z.infer<typeof computerPairingStatusSchema>

/** Sent by the desktop app when it connects to the `/computer` socket namespace. */
export const computerAnnounceSchema = z.object({
  computerId: idSchema,
  name: z.string().trim().min(1).max(120),
  os: computerOsSchema,
  arch: z.string().trim().min(1).max(40),
  appVersion: z.string().trim().min(1).max(40),
  accessMode: computerAccessModeSchema,
  rootPath: z.string().min(1).max(4_096),
  attachmentsDir: z.string().min(1).max(4_096),
  homeDir: z.string().max(4_096),
  shell: computerShellSchema,
  approvalPolicy: computerApprovalPolicySchema,
  allowRemote: z.boolean(),
})
export type ComputerAnnounce = z.infer<typeof computerAnnounceSchema>

export const computerPairingSchema = z.object({
  id: idSchema,
  computerId: idSchema,
  computerName: z.string(),
  status: computerPairingStatusSchema,
  deviceSessionId: idSchema,
  deviceLabel: z.string(),
  appType: z.string(),
  platform: z.string(),
  browser: z.string().nullable(),
  requestedIp: z.string().nullable(),
  requestedAt: isoDateSchema,
  decidedAt: isoDateSchema.nullable(),
  /** True when the pairing belongs to the session making the request. */
  isCurrentDevice: z.boolean(),
})
export type ComputerPairing = z.infer<typeof computerPairingSchema>

export const agentComputerSchema = z.object({
  id: idSchema,
  name: z.string(),
  os: computerOsSchema,
  arch: z.string(),
  appVersion: z.string(),
  accessMode: computerAccessModeSchema,
  rootPath: z.string(),
  approvalPolicy: computerApprovalPolicySchema,
  allowRemote: z.boolean(),
  enabled: z.boolean(),
  online: z.boolean(),
  /** True when the requesting session is the desktop session that owns the computer. */
  isOwnedByThisDevice: z.boolean(),
  /** The requesting session's pairing with this computer, if any. Owners have none. */
  pairing: z.object({ id: idSchema, status: computerPairingStatusSchema }).nullable(),
  /** True when the requesting session may select this computer as a workspace right now. */
  selectable: z.boolean(),
  lastSeenAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
})
export type AgentComputer = z.infer<typeof agentComputerSchema>
export const agentComputerListSchema = z.object({ computers: z.array(agentComputerSchema) })
export type AgentComputerList = z.infer<typeof agentComputerListSchema>

export const updateAgentComputerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  accessMode: computerAccessModeSchema.optional(),
  rootPath: z.string().min(1).max(4_096).optional(),
  approvalPolicy: computerApprovalPolicySchema.optional(),
  allowRemote: z.boolean().optional(),
  enabled: z.boolean().optional(),
})
export type UpdateAgentComputerInput = z.infer<typeof updateAgentComputerSchema>

export const computerPairingListSchema = z.object({ pairings: z.array(computerPairingSchema) })
export type ComputerPairingList = z.infer<typeof computerPairingListSchema>

export const workspaceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sandbox') }),
  z.object({ kind: z.literal('computer'), computerId: idSchema }),
])
export type WorkspaceSelection = z.infer<typeof workspaceSelectionSchema>

export const toolApprovalKindSchema = z.enum(['bash', 'write', 'edit'])
export type ToolApprovalKind = z.infer<typeof toolApprovalKindSchema>
export const toolApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled'])
export type ToolApprovalStatus = z.infer<typeof toolApprovalStatusSchema>
export const toolApprovalDecisionSourceSchema = z.enum(['chat', 'desktop'])
export type ToolApprovalDecisionSource = z.infer<typeof toolApprovalDecisionSourceSchema>

export const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000
export const TOOL_APPROVAL_SUMMARY_MAX_CHARACTERS = 2_000

/** Which tool kinds a computer's approval policy gates. */
export function toolApprovalRequired(kind: string, policy: ComputerApprovalPolicy): kind is ToolApprovalKind {
  if (policy === 'never') return false
  if (policy === 'bash-only') return kind === 'bash'
  return kind === 'bash' || kind === 'write' || kind === 'edit'
}

/** Timeline output item that renders the approve/deny prompt inside a chat. */
export const toolApprovalItemSchema = z.object({
  id: idSchema,
  type: z.literal('pulpo_approval'),
  tool_call_id: z.string().min(1),
  kind: toolApprovalKindSchema,
  summary: z.string(),
  status: toolApprovalStatusSchema,
  computer_name: z.string(),
  expires_at: isoDateSchema,
  decided_at: isoDateSchema.optional(),
  decided_via: toolApprovalDecisionSourceSchema.optional(),
})
export type ToolApprovalItem = z.infer<typeof toolApprovalItemSchema>

/** REST and desktop-socket representation of an approval request. */
export const toolApprovalSchema = z.object({
  id: idSchema,
  responseId: idSchema,
  chatId: idSchema,
  computerId: idSchema,
  computerName: z.string(),
  toolCallId: z.string(),
  kind: toolApprovalKindSchema,
  summary: z.string(),
  status: toolApprovalStatusSchema,
  expiresAt: isoDateSchema,
  decidedAt: isoDateSchema.nullable(),
  decidedVia: toolApprovalDecisionSourceSchema.nullable(),
  createdAt: isoDateSchema,
})
export type ToolApproval = z.infer<typeof toolApprovalSchema>

export const toolApprovalDecisionSchema = z.object({ approvalId: idSchema, approved: z.boolean() })
export type ToolApprovalDecision = z.infer<typeof toolApprovalDecisionSchema>
export const computerPairingDecisionSchema = z.object({ pairingId: idSchema, approved: z.boolean() })
export type ComputerPairingDecision = z.infer<typeof computerPairingDecisionSchema>

/** Describes the workspace an agent run operates in; drives prompts, tool text, and timeline labels. */
export const workspaceDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sandbox') }),
  z.object({
    kind: z.literal('computer'),
    computerId: idSchema,
    computerName: z.string(),
    os: computerOsSchema,
    accessMode: computerAccessModeSchema,
    root: z.string(),
    attachmentsDir: z.string(),
    homeDir: z.string(),
    shell: computerShellSchema,
    approvalPolicy: computerApprovalPolicySchema,
  }),
])
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>
export type ComputerWorkspaceDescriptor = Extract<WorkspaceDescriptor, { kind: 'computer' }>

export const COMPUTER_FILE_CHUNK_BYTES = 1024 * 1024
export const COMPUTER_HEARTBEAT_INTERVAL_MS = 20_000
export const COMPUTER_PRESENCE_TTL_SECONDS = 60

/** Requests relayed from the agent worker to the desktop app over the `/computer` namespace. */
export type ComputerRequest = { chatId: string; responseId?: string; requesterSessionId?: string } & (
  | { kind: 'operation.start'; id: string; type: string; args: Record<string, unknown>; approvalId?: string }
  | { kind: 'operation.status'; id: string }
  | { kind: 'operation.cancel'; id: string }
  | { kind: 'files.missing'; files: Array<{ path: string; checksum: string | null; sizeBytes: number }> }
  | { kind: 'file.begin'; transferId: string; path: string; sizeBytes: number; checksum: string | null }
  | { kind: 'file.chunk'; transferId: string; data: string }
  | { kind: 'file.end'; transferId: string }
  | { kind: 'file.read'; scope: 'export' | 'image'; path: string; offset: number; length: number; maxBytes: number }

)

/** Stable per-chat attachment location under the computer's announced storage root. */
export function computerChatAttachmentsDirectory(root: string, chatId: string, os: ComputerOs): string {
  idSchema.parse(chatId)
  const separator = os === 'windows' ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${chatId}${separator}attachments`
}

export interface ComputerOperationSnapshot {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  error?: string
  details?: Record<string, unknown>
}

export type ComputerRequestResult = {
  'operation.start': ComputerOperationSnapshot
  'operation.status': ComputerOperationSnapshot | null
  'operation.cancel': ComputerOperationSnapshot | null
  'files.missing': { missing: string[] }
  'file.begin': { transferId: string }
  'file.chunk': { received: number }
  'file.end': { path: string }
  'file.read': { data: string; sizeBytes: number; eof: boolean }
}

export type ComputerReplyErrorCode = 'approval_required' | 'invalid_request' | 'disabled' | 'failed'

export type ComputerReply<K extends ComputerRequest['kind'] = ComputerRequest['kind']> =
  | { ok: true; result: ComputerRequestResult[K] }
  | { ok: false; error: string; code: ComputerReplyErrorCode }

export interface ComputerClientToServerEvents {
  'computer.heartbeat': () => void
  'computer.pairing.code': (ack: (result: { code?: string; expiresAt?: string; error?: string }) => void) => void
  'computer.approval.verify': (input: { approvalId: string; chatId: string; operationId: string; digest: string }, ack: (approved: boolean) => void) => void
  'computer.update': (input: Partial<ComputerAnnounce>, ack?: (result: { ok: boolean; error?: string }) => void) => void
}

export interface ComputerServerToClientEvents {
  'computer.ready': (input: { sessionId: string }) => void
  'computer.access.granted': (input: { sessionId: string }) => void
  'computer.response.revoked': (input: { responseId: string }) => void
  'computer.access.revoked': (input: { sessionId: string }) => void
  'computer.request': (request: ComputerRequest, ack: (reply: ComputerReply) => void) => void
  'computer.approval.requested': (approval: ToolApproval) => void
  'computer.approval.decided': (input: { approvalId: string; status: ToolApprovalStatus }) => void
  'computer.pairing.decided': (input: { pairingId: string; status: ComputerPairingStatus }) => void
  'computer.revoked': (input: { reason: 'disabled' | 'deleted' | 'session_revoked' }) => void
  'computer.superseded': () => void
}

export function computerOsLabel(os: ComputerOs): string {
  return os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux'
}

export type DesktopComputerStatus = 'disabled' | 'connecting' | 'online' | 'offline' | 'error'

/** What the desktop renderer sees about the local computer agent through the preload bridge. */
export interface DesktopComputerState {
  status: DesktopComputerStatus
  error: string | null
  computerId: string
  name: string
  enabled: boolean
  accessMode: ComputerAccessMode
  rootPath: string | null
  approvalPolicy: ComputerApprovalPolicy
  allowRemote: boolean
  os: ComputerOs
  hostname: string
  homeDir: string
  pendingApprovals: number
  pendingPairings: number
}

export interface DesktopComputerUpdate {
  enabled?: boolean
  name?: string
  accessMode?: ComputerAccessMode
  rootPath?: string | null
  approvalPolicy?: ComputerApprovalPolicy
  allowRemote?: boolean
}

/** Stable exact-action representation for approval verification. */
export function computerActionPayload(chatId: string, operationId: string, type: string, args: Record<string, unknown>, context?: { computerId: string; root: string; accessMode: string }): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
    return value
  }
  return JSON.stringify(canonical({ chatId, operationId, type, args, context }))
}
