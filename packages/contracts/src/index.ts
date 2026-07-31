import { z } from 'zod'

export const idSchema = z.uuid()
export const isoDateSchema = z.iso.datetime()

export const roleSchema = z.enum(['pending', 'user', 'admin'])
export type Role = z.infer<typeof roleSchema>

export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  name: z.string().min(1).max(120),
  role: roleSchema,
  balanceMicros: z.number().int(),
  blocked: z.boolean(),
  stateRevision: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
})
export type User = z.infer<typeof userSchema>

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(1024),
})

export const signupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(1024),
})

export const setupInputSchema = signupInputSchema

export const apiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string(),
    param: z.string().nullable().optional(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const responseStatusSchema = z.enum([
  'queued',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
])
export type ResponseStatus = z.infer<typeof responseStatusSchema>

export const executionModeSchema = z.enum(['stream', 'background'])
export type ExecutionMode = z.infer<typeof executionModeSchema>

export const responseUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative(),
})
export type ResponseUsage = z.infer<typeof responseUsageSchema>

export const storedResponseSchema = z.object({
  id: idSchema,
  chatId: idSchema,
  userId: idSchema,
  modelId: z.string().min(1),
  openaiResponseId: z.string().nullable(),
  previousResponseId: idSchema.nullable(),
  status: responseStatusSchema,
  executionMode: executionModeSchema,
  lastSequence: z.number().int().nonnegative(),
  usage: responseUsageSchema.nullable(),
  output: z.array(z.unknown()),
  error: z.unknown().nullable(),
  createdAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
})
export type StoredResponse = z.infer<typeof storedResponseSchema>

export const responseEventSchema = z.object({
  responseId: idSchema,
  sequence: z.number().int().positive(),
  type: z.string().min(1),
  payload: z.unknown(),
  emittedAt: isoDateSchema,
})
export type ResponseEvent = z.infer<typeof responseEventSchema>

export const responseSnapshotSchema = z.object({
  responseId: idSchema,
  status: responseStatusSchema,
  sequence: z.number().int().nonnegative(),
  output: z.array(z.unknown()),
  usage: responseUsageSchema.nullable(),
  error: z.unknown().nullable(),
  updatedAt: isoDateSchema,
})
export type ResponseSnapshot = z.infer<typeof responseSnapshotSchema>

export const modelSchema = z.object({
  id: z.string().min(1).max(120),
  upstreamModelId: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  description: z.string(),
  enabled: z.boolean(),
  executionMode: executionModeSchema,
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  inputPriceMicros: z.number().int().nonnegative(),
  cachedInputPriceMicros: z.number().int().nonnegative(),
  outputPriceMicros: z.number().int().nonnegative(),
  tags: z.array(z.string()),
})
export type Model = z.infer<typeof modelSchema>

export const createProviderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: z.url().default('https://api.openai.com/v1'),
  apiKey: z.string().min(1),
  organizationId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(900_000).default(120_000),
})

export const createModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerConnectionId: idSchema,
  labId: idSchema.nullable().default(null),
  upstreamModelId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(''),
  enabled: z.boolean().default(true),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  executionMode: executionModeSchema.default('stream'),
  tags: z.array(z.string()).default([]),
  allowedParameters: z.array(z.string()).default([]),
  inputPriceMicros: z.number().int().nonnegative(),
  cachedInputPriceMicros: z.number().int().nonnegative(),
  outputPriceMicros: z.number().int().nonnegative(),
  perRequestPriceMicros: z.number().int().nonnegative().default(0),
})

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(['responses', 'models'])).min(1),
  allowedModels: z.array(z.string()).default([]),
  monthlyBudgetMicros: z.number().int().positive().nullable().default(null),
  lifetimeBudgetMicros: z.number().int().positive().nullable().default(null),
})

export const chatSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  modelId: z.string(),
  pinned: z.boolean(),
  folderId: idSchema.nullable(),
  temporary: z.boolean(),
  updatedAt: isoDateSchema,
  activeResponseId: idSchema.nullable(),
})
export type ChatSummary = z.infer<typeof chatSummarySchema>

export const createChatSchema = z.object({
  clientId: idSchema.optional(),
  modelId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  temporary: z.boolean().default(false),
})

export const createChatResponseSchema = z.object({
  input: z.string().trim().min(1).max(1_000_000),
  modelId: z.string().min(1),
  executionMode: executionModeSchema.optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  presetSelections: z.record(z.string(), z.string()).default({}),
  attachmentIds: z.array(idSchema).default([]),
})
export type CreateChatResponseInput = z.infer<typeof createChatResponseSchema>

export const syncRequestSchema = z.object({
  tabId: z.string().min(1).max(128),
  accountRevision: z.number().int().nonnegative(),
  activeChatId: idSchema.optional(),
  responseCursors: z.record(idSchema, z.number().int().nonnegative()),
})
export type SyncRequest = z.infer<typeof syncRequestSchema>

export const syncResultSchema = z.object({
  accountRevision: z.number().int().nonnegative(),
  invalidate: z.array(z.enum(['chats', 'models', 'usage', 'settings'])),
  snapshots: z.array(responseSnapshotSchema),
  events: z.array(responseEventSchema),
})
export type SyncResult = z.infer<typeof syncResultSchema>

export interface ClientToServerEvents {
  'client.sync': (input: SyncRequest, ack: (result: SyncResult) => void) => void
  'chat.subscribe': (input: { chatId: string }) => void
  'chat.unsubscribe': (input: { chatId: string }) => void
  'response.subscribe': (input: { responseId: string; afterSequence: number }) => void
  'response.unsubscribe': (input: { responseId: string }) => void
}

export interface ServerToClientEvents {
  'response.event': (event: ResponseEvent) => void
  'response.snapshot': (snapshot: ResponseSnapshot) => void
  'response.completed': (input: { responseId: string; chatId: string; preview: string }) => void
  'chat.changed': (input: { chatId: string; revision: number }) => void
  'account.revision': (input: { revision: number }) => void
  'usage.changed': (input: { balanceMicros: number; spentThisMonthMicros: number }) => void
  'sync.result': (result: SyncResult) => void
}
