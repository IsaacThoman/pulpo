import { z } from 'zod'
import { CHAT_PRESET_ICON_NAMES } from './chat-preset-icons.generated.js'

export { CHAT_PRESET_ICON_NAMES } from './chat-preset-icons.generated.js'

export const idSchema = z.uuid()
export const isoDateSchema = z.iso.datetime()
export const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_CONFIGURABLE_ATTACHMENT_BYTES = 1_000 * 1024 * 1024

export const roleSchema = z.enum(['pending', 'user', 'admin'])
export type Role = z.infer<typeof roleSchema>

export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  name: z.string().min(1).max(120),
  role: roleSchema,
  balanceMicros: z.number().int(),
  storageLimitBytes: z.number().int().nonnegative(),
  blocked: z.boolean(),
  stateRevision: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
})
export type User = z.infer<typeof userSchema>

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(1024),
  twoFactorCode: z.string().trim().min(6).max(32).optional(),
})

export const signupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(1024),
})

export const setupInputSchema = signupInputSchema

export const nativeDeviceSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(120),
})

export const nativeLoginInputSchema = loginInputSchema.and(nativeDeviceSchema)
export const nativeSignupInputSchema = signupInputSchema.and(nativeDeviceSchema)

export const nativeSessionSchema = z.object({
  token: z.string().min(32),
  expiresAt: isoDateSchema,
})
export type NativeSession = z.infer<typeof nativeSessionSchema>

export const nativeAuthResponseSchema = z.object({
  user: userSchema,
  session: nativeSessionSchema,
})
export type NativeAuthResponse = z.infer<typeof nativeAuthResponseSchema>

export const mobileConfigSchema = z.object({
  mobileApiVersion: z.literal(1),
  instance: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    publicUrl: z.url(),
  }),
  setupRequired: z.boolean(),
  auth: z.object({
    signupEnabled: z.boolean(),
    pendingDetails: z.boolean(),
    adminEmail: z.string(),
    pendingMessage: z.string(),
  }),
  limits: z.object({
    maxAttachmentBytes: z.number().int().nonnegative().max(MAX_CONFIGURABLE_ATTACHMENT_BYTES),
  }).default({ maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES }),
  capabilities: z.object({
    bearerSessions: z.literal(true),
    realtime: z.literal(true),
    chatDuplication: z.literal(true),
    publicSharing: z.literal(true),
    attachments: z.literal(true),
    folders: z.literal(true),
    twoFactorAuth: z.boolean().optional().default(false),
  }),
})
export type MobileConfig = z.infer<typeof mobileConfigSchema>

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
})
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>

export const beginTwoFactorEnrollmentInputSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  verificationCode: z.string().trim().min(6).max(32).optional(),
})

export const twoFactorEnrollmentSchema = z.object({
  manualKey: z.string().min(16),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
  qrCodeDataUrl: z.string().startsWith('data:image/'),
  expiresAt: isoDateSchema,
})
export type TwoFactorEnrollment = z.infer<typeof twoFactorEnrollmentSchema>

export const confirmTwoFactorEnrollmentInputSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter a six-digit authenticator code'),
})

export const verifyTwoFactorChangeInputSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  verificationCode: z.string().trim().min(6).max(32),
})

export const twoFactorRecoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()).length(10),
})
export type TwoFactorRecoveryCodes = z.infer<typeof twoFactorRecoveryCodesSchema>

export const updateProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(8).max(1024),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'New password must be different from the current password',
  path: ['newPassword'],
})

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

export const compactionRetainedEntrySchema = z.object({
  role: z.enum(['developer', 'user', 'assistant', 'tool']),
  content: z.string(),
})
export type CompactionRetainedEntry = z.infer<typeof compactionRetainedEntrySchema>

export const compactionItemSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pulpo_compaction'),
  phase: z.enum(['pre_response', 'agent_mid_run']),
  status: z.enum(['in_progress', 'completed', 'failed']),
  model_id: z.string().min(1),
  estimated_tokens: z.number().int().nonnegative(),
  threshold_tokens: z.number().int().positive(),
  retained_turns: z.array(compactionRetainedEntrySchema).default([]),
  retained_context: z.array(z.unknown()).default([]),
  retained_context_turns: z.array(z.array(z.unknown())).default([]),
  summary: z.string().default(''),
  started_at: isoDateSchema,
  duration_ms: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  covered_through_response_id: idSchema.optional(),
  before_agent_turn: z.number().int().positive().optional(),
})
export type CompactionItem = z.infer<typeof compactionItemSchema>

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

/** Snapshot marker embedded in compact chat history; output lives on the response once. */
export const embeddedResponseSnapshotSchema = responseSnapshotSchema.omit({ output: true })
export type EmbeddedResponseSnapshot = z.infer<typeof embeddedResponseSnapshotSchema>

type DeltaTarget = {
  item_id?: unknown
  itemId?: unknown
  output_index?: unknown
  outputIndex?: unknown
  content_index?: unknown
  contentIndex?: unknown
  agent_turn?: unknown
}

function targetItemIndex(output: Array<Record<string, unknown>>, payload: DeltaTarget, type: string): number {
  const itemId = typeof payload.item_id === 'string' ? payload.item_id
    : typeof payload.itemId === 'string' ? payload.itemId : undefined
  if (itemId) {
    const byId = output.findIndex((item) => item.id === itemId)
    // A targeted delta for an unseen item starts a new item. Falling through to
    // the active-tail heuristic would temporarily append a new agent turn to
    // the preceding turn until the next authoritative snapshot arrives.
    return byId
  }
  const outputIndex = typeof payload.output_index === 'number' ? payload.output_index
    : typeof payload.outputIndex === 'number' ? payload.outputIndex : undefined
  if (outputIndex !== undefined && output[outputIndex]?.type === type) return outputIndex
  const agentTurn = typeof payload.agent_turn === 'number' ? payload.agent_turn : undefined
  const contentIndex = typeof payload.content_index === 'number' ? payload.content_index
    : typeof payload.contentIndex === 'number' ? payload.contentIndex : undefined
  if (agentTurn !== undefined && contentIndex !== undefined) {
    const byAgentPart = output.findIndex((item) =>
      item.type === type && item.agent_turn === agentTurn && item.agent_content_index === contentIndex)
    if (byAgentPart >= 0) return byAgentPart
  }
  // Untargeted legacy/non-agent events always belong to the currently active tail item.
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output[index]?.type === type && output[index]?.status === 'in_progress') return index
  }
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output[index]?.type === type) return index
  }
  return -1
}

function appendOutputText(output: unknown[], delta: string, payload: DeltaTarget): unknown[] {
  const copy = output.slice() as Array<Record<string, unknown>>
  const index = targetItemIndex(copy, payload, 'message')
  let message = index >= 0 ? { ...copy[index] } : undefined
  if (!message) {
    const itemId = typeof payload.item_id === 'string' ? payload.item_id
      : typeof payload.itemId === 'string' ? payload.itemId : undefined
    message = { ...(itemId ? { id: itemId } : {}), type: 'message', role: 'assistant', status: 'in_progress', content: [] }
    copy.push(message)
  } else {
    copy[index] = message
  }
  const content = Array.isArray(message.content) ? message.content.slice() as Array<Record<string, unknown>> : []
  const contentIndex = typeof payload.content_index === 'number' ? payload.content_index
    : typeof payload.contentIndex === 'number' ? payload.contentIndex : undefined
  const partIndex = contentIndex !== undefined && content[contentIndex]?.type === 'output_text'
    ? contentIndex
    : content.findIndex((item) => item.type === 'output_text')
  let part = partIndex >= 0 ? { ...content[partIndex] } : undefined
  if (!part) {
    part = { type: 'output_text', text: '' }
    content.push(part)
  } else {
    content[partIndex] = part
  }
  part.text = `${typeof part.text === 'string' ? part.text : ''}${delta}`
  message.content = content
  return copy
}

function appendReasoning(output: unknown[], delta: string, payload: DeltaTarget): unknown[] {
  const copy = output.slice() as Array<Record<string, unknown>>
  const index = targetItemIndex(copy, payload, 'reasoning')
  let reasoning = index >= 0 ? { ...copy[index] } : undefined
  if (!reasoning) {
    const itemId = typeof payload.item_id === 'string' ? payload.item_id
      : typeof payload.itemId === 'string' ? payload.itemId : undefined
    reasoning = { ...(itemId ? { id: itemId } : {}), type: 'reasoning', status: 'in_progress', summary: [] }
    copy.push(reasoning)
  } else {
    copy[index] = reasoning
  }
  const summary = Array.isArray(reasoning.summary) ? reasoning.summary.slice() as Array<Record<string, unknown>> : []
  const partIndex = summary.findIndex((item) => item.type === 'summary_text')
  let part = partIndex >= 0 ? { ...summary[partIndex] } : undefined
  if (!part) {
    part = { type: 'summary_text', text: '' }
    summary.push(part)
  } else {
    summary[partIndex] = part
  }
  part.text = `${typeof part.text === 'string' ? part.text : ''}${delta}`
  reasoning.summary = summary
  return copy
}

function upsertOutputItem(
  output: unknown[],
  match: (item: Record<string, unknown>) => boolean,
  value: Record<string, unknown>,
): unknown[] {
  const copy = output.slice()
  const index = copy.findIndex((item) => Boolean(item) && typeof item === 'object' && match(item as Record<string, unknown>))
  if (index < 0) copy.push(value)
  else copy[index] = { ...(copy[index] as Record<string, unknown>), ...value }
  return copy
}

function applyAgentEventOutput(output: unknown[], event: ResponseEvent): unknown[] {
  const payload = event.payload as Record<string, unknown>
  if (event.type.startsWith('pulpo.agent.workspace.')) {
    return upsertOutputItem(output, (item) => item.type === 'pulpo_workspace', payload)
  }
  if (event.type === 'pulpo.compaction.updated' && typeof payload.id === 'string') {
    return upsertOutputItem(output, (item) => item.id === payload.id, payload)
  }
  if (event.type === 'pulpo.agent.attachment.created' && typeof payload.attachment_id === 'string') {
    return upsertOutputItem(output, (item) => item.type === 'pulpo_attachment' && item.attachment_id === payload.attachment_id, payload)
  }
  if (!event.type.startsWith('pulpo.agent.tool.') || typeof payload.id !== 'string') return output
  if (event.type === 'pulpo.agent.tool.delta') {
    return upsertOutputItem(output, (item) => item.id === payload.id, {
      id: payload.id,
      type: 'pulpo_tool',
      output: typeof payload.delta === 'string' ? payload.delta : '',
      status: 'running',
    })
  }
  if (event.type === 'pulpo.agent.tool.completed') {
    return upsertOutputItem(output, (item) => item.id === payload.id, {
      ...payload,
      type: 'pulpo_tool',
      status: payload.isError ? 'failed' : 'completed',
    })
  }
  return upsertOutputItem(output, (item) => item.id === payload.id, payload)
}

export function applyResponseEventToSnapshot(snapshot: ResponseSnapshot, event: ResponseEvent): ResponseSnapshot {
  if (event.sequence <= snapshot.sequence) return snapshot
  const payload = event.payload as DeltaTarget & { delta?: unknown }
  const delta = typeof payload.delta === 'string' ? payload.delta : ''
  let output = snapshot.output
  if (delta && event.type === 'response.output_text.delta') output = appendOutputText(output, delta, payload)
  if (delta && event.type === 'response.reasoning_summary_text.delta') output = appendReasoning(output, delta, payload)
  output = applyAgentEventOutput(output, event)
  return {
    ...snapshot,
    status: snapshot.status === 'queued' ? 'in_progress' : snapshot.status,
    sequence: event.sequence,
    output,
    updatedAt: event.emittedAt,
  }
}

export function mergeResponseSnapshots(current: ResponseSnapshot, incoming: ResponseSnapshot): ResponseSnapshot {
  if (incoming.sequence < current.sequence) return current
  if (incoming.sequence === current.sequence) {
    const currentTerminal = current.status !== 'queued' && current.status !== 'in_progress'
    const incomingTerminal = incoming.status !== 'queued' && incoming.status !== 'in_progress'
    if (currentTerminal && !incomingTerminal) return current
    if (incomingTerminal && !currentTerminal) {
      return incoming.output.length === 0 && current.output.length > 0
        ? { ...incoming, output: current.output }
        : incoming
    }
    if (incoming.updatedAt < current.updatedAt) return current
    if (incoming.updatedAt === current.updatedAt) {
      if (current.output.length === 0 && incoming.output.length > 0) return incoming
      return current
    }
    if (incoming.output.length === 0 && current.output.length > 0) {
      return { ...incoming, output: current.output }
    }
  }
  const incomingIsActive = incoming.status === 'queued' || incoming.status === 'in_progress'
  if (incomingIsActive && incoming.output.length === 0 && current.output.length > 0) {
    return { ...incoming, output: current.output }
  }
  return incoming
}

export const catalogIconModeSchema = z.enum(['original', 'monochrome'])
export const catalogIconReferenceSchema = z.object({
  id: idSchema,
  mode: catalogIconModeSchema,
  lightUrl: z.string().startsWith('/api/catalog-icons/'),
  darkUrl: z.string().startsWith('/api/catalog-icons/'),
})
export type CatalogIconMode = z.infer<typeof catalogIconModeSchema>
export type CatalogIconReference = z.infer<typeof catalogIconReferenceSchema>

export const modelSchema = z.object({
  id: z.string().min(1).max(120),
  upstreamModelId: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  description: z.string(),
  enabled: z.boolean(),
  visible: z.boolean(),
  logo: z.string().nullable(),
  customIconId: idSchema.nullable().optional(),
  customIcon: catalogIconReferenceSchema.nullable().optional(),
  executionMode: executionModeSchema,
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  inputPriceMicros: z.number().int().nonnegative(),
  cachedInputPriceMicros: z.number().int().nonnegative(),
  outputPriceMicros: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  agentEnabled: z.boolean().default(false),
})
export type Model = z.infer<typeof modelSchema>

const orderedPreferenceIdsSchema = z.array(z.string().trim().min(1).max(200)).max(500)
  .transform((ids) => [...new Set(ids)])

/** Account-scoped model picker customization shared by web and mobile. */
export const modelPreferencesSchema = z.object({
  favoriteModelIds: orderedPreferenceIdsSchema.default([]),
  providerOrder: orderedPreferenceIdsSchema.default([]),
})
export const modelPreferencesPatchSchema = z.object({
  favoriteModelIds: orderedPreferenceIdsSchema.optional(),
  providerOrder: orderedPreferenceIdsSchema.optional(),
})
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>

/** Instance defaults copied into each account when it is created. */
export const newAccountModelDefaultsSchema = z.object({
  defaultModelId: z.string().trim().min(1).max(120).nullable().default(null),
  favoriteModelIds: orderedPreferenceIdsSchema.default([]),
})
export type NewAccountModelDefaults = z.infer<typeof newAccountModelDefaultsSchema>

export const createProviderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: z.url().default('https://api.openai.com/v1'),
  apiKey: z.string().min(1),
  organizationId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(900_000).default(120_000),
})

export type ChatPresetIcon = (typeof CHAT_PRESET_ICON_NAMES)[number]

const chatPresetIconNames = new Set<string>(CHAT_PRESET_ICON_NAMES)

export function isChatPresetIcon(value: unknown): value is ChatPresetIcon {
  return typeof value === 'string' && chatPresetIconNames.has(value)
}

export const chatPresetIconSchema = z.custom<ChatPresetIcon>(
  isChatPresetIcon,
  'Unknown chat preset icon; run `pulpo model icons [query]` to list valid names',
)

const chatPresetPublicIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/)

export const chatPresetChoiceSchema = z.object({
  id: chatPresetPublicIdSchema,
  displayName: z.string().trim().min(1).max(80),
  icon: chatPresetIconSchema.nullable().optional(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('redirect'), modelId: z.string().min(1).max(120) }),
    z.object({ type: z.literal('params'), params: z.record(z.string(), z.unknown()) }),
  ]),
})

export const chatPresetSchema = z.object({
  id: chatPresetPublicIdSchema,
  name: z.string().trim().min(1).max(80),
  icon: chatPresetIconSchema,
  defaultChoiceId: chatPresetPublicIdSchema.nullable().optional(),
  choices: z.array(chatPresetChoiceSchema).min(1).max(20),
}).superRefine((preset, context) => {
  const ids = new Set<string>()
  for (const [index, choice] of preset.choices.entries()) {
    if (ids.has(choice.id)) {
      context.addIssue({ code: 'custom', path: ['choices', index, 'id'], message: 'Choice IDs must be unique within a preset' })
    }
    ids.add(choice.id)
  }
  if (preset.defaultChoiceId && !ids.has(preset.defaultChoiceId)) {
    context.addIssue({ code: 'custom', path: ['defaultChoiceId'], message: 'Default choice must reference an existing choice' })
  }
})

export const chatPresetsSchema = z.array(chatPresetSchema).max(10).superRefine((presets, context) => {
  const ids = new Set<string>()
  for (const [index, preset] of presets.entries()) {
    if (ids.has(preset.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Preset IDs must be unique for a model' })
    }
    ids.add(preset.id)
  }
})

export type ChatPresetAction = z.infer<typeof chatPresetChoiceSchema>['action']
export type ChatPresetChoice = z.infer<typeof chatPresetChoiceSchema>
export type ChatPreset = z.infer<typeof chatPresetSchema>

export const UNKNOWN_MODEL_ID = 'pulpo-unknown-model'

export const createModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerConnectionId: idSchema,
  labId: idSchema.nullable().default(null),
  upstreamModelId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(''),
  enabled: z.boolean().default(true),
  visible: z.boolean().default(true),
  logo: z.string().max(120).nullable().default(null),
  customIconId: idSchema.nullable().default(null),
  systemPrompt: z.string().max(100_000).default(''),
  agentEnabled: z.boolean().default(false),
  agentInstructions: z.string().max(100_000).default(''),
  defaultParameters: z.record(z.string(), z.unknown()).default({}),
  interceptImagesWithOcr: z.boolean().default(false),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  compactionEnabled: z.boolean().default(true),
  compactionThresholdTokens: z.number().int().min(2_000).max(1_000_000).default(100_000),
  agentCompactionThresholdTokens: z.number().int().min(2_000).max(1_000_000).default(180_000),
  compactionRetainedTurns: z.number().int().min(1).max(32).default(4),
  executionMode: executionModeSchema.default('stream'),
  tags: z.array(z.string()).default([]),
  allowedParameters: z.array(z.string()).default([]),
  useProviderCost: z.boolean().default(false),
  fallbackModelId: z.string().min(1).max(120).nullable().default(null),
  maxRetries: z.number().int().min(0).max(10).default(0),
  retryDelaySeconds: z.number().int().min(0).max(300).default(1),
  stickyFallbackSeconds: z.number().int().min(0).max(86_400).default(0),
  firstTokenTimeoutEnabled: z.boolean().default(false),
  firstTokenTimeoutSeconds: z.number().int().min(1).max(900).default(30),
  slowStickyEnabled: z.boolean().default(false),
  slowStickyMinTokensPerSecond: z.number().positive().max(10_000).default(5),
  slowStickyMinCompletionSeconds: z.number().int().min(1).max(86_400).default(30),
  inputPriceMicros: z.number().int().nonnegative(),
  cachedInputPriceMicros: z.number().int().nonnegative(),
  outputPriceMicros: z.number().int().nonnegative(),
  perRequestPriceMicros: z.number().int().nonnegative().default(0),
})

export const detailedPayloadRetentionSchema = z.enum(['1h', '24h', '7d', '30d', '90d', 'indefinite'])
export const loggingSettingsSchema = z.object({
  logDetailedPayloads: z.boolean().default(false),
  payloadRetention: detailedPayloadRetentionSchema.default('7d'),
})
export const DEFAULT_OCR_SYSTEM_PROMPT = 'convert the image to markdown/latex if applicable, otherwise describe the non-text content part of the image in detail. if there is text present in the image, provide all of the text in the image, unabridged verbatim'
export const ocrSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  cacheEnabled: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().min(60).max(31_536_000).default(3600),
  providerMode: z.enum(['existing', 'custom']).default('existing'),
  providerConnectionId: idSchema.nullable().default(null),
  customBaseUrl: z.url().nullable().default(null),
  customApiKey: z.string().min(1).optional(),
  model: z.string().min(1).max(200).default('gpt-4.1-mini'),
  systemPrompt: z.string().max(100_000).default(DEFAULT_OCR_SYSTEM_PROMPT),
})

const agentMemorySchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const legacyGi = value.trim().match(/^([1-9]\d*)Gi$/)
  return legacyGi ? `${Number(legacyGi[1]) * 1024}Mi` : value.trim()
}, z.string().regex(/^[1-9]\d*Mi$/, 'Memory must be an integer number of MiB, for example 2048Mi').default('2048Mi'))

const agentCpuSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const legacyMillicores = value.trim().match(/^([1-9]\d*)m$/)
  return legacyMillicores ? String(Number(legacyMillicores[1]) / 1000) : value.trim()
}, z.string().regex(/^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/, 'CPU must be a positive number of cores, for example 2 or 0.5').default('2'))

const agentDiskSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const legacyMi = value.trim().match(/^([1-9]\d*)Mi$/)
  if (legacyMi) return `${Math.ceil(Number(legacyMi[1]) / 1024)}Gi`
  return value.trim()
}, z.string().regex(/^[1-9]\d*Gi$/, 'Ephemeral disk must be an integer number of GiB, for example 20Gi').default('20Gi'))

export const agentSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  generationConcurrency: z.number().int().min(1).max(100).default(8),
  imageDigest: z.string().regex(/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/).default('ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:0000000000000000000000000000000000000000000000000000000000000000'),
  warmCapacity: z.number().int().min(0).max(100).default(1),
  maxActiveWorkspaces: z.number().int().min(1).max(1_000).default(3),
  cpu: agentCpuSchema,
  memory: agentMemorySchema,
  ephemeralStorage: agentDiskSchema,
  idleTimeoutSeconds: z.number().int().min(60).max(604_800).default(1_800),
  hardTimeoutSeconds: z.number().int().min(300).max(2_592_000).default(14_400),
  workspaceWaitTimeoutSeconds: z.number().int().min(30).max(86_400).default(900),
  maxModelTurns: z.number().int().min(1).max(100).default(30),
  maxToolCalls: z.number().int().min(1).max(1_000).default(100),
  responseTimeoutSeconds: z.number().int().min(60).max(86_400).default(1_800),
  commandTimeoutSeconds: z.number().int().min(1).max(3_600).default(600),
  maxToolOutputBytes: z.number().int().min(1_024).max(10_000_000).default(100_000),
})
export type AgentSettings = z.infer<typeof agentSettingsSchema>

export const webToolProviderSchema = z.enum(['kagi', 'firecrawl'])
export type WebToolProvider = z.infer<typeof webToolProviderSchema>

const webToolProviderOrderSchema = z.array(webToolProviderSchema).length(2).refine(
  (value) => new Set(value).size === 2,
  'Provider order must contain Kagi and Firecrawl exactly once',
)

export const kagiWebProviderSettingsSchema = z.object({
  searchEnabled: z.boolean().default(true),
  billSearches: z.boolean().default(false),
  searchPriceMicros: z.number().int().min(0).max(1_000_000_000).default(12_000),
  extractEnabled: z.boolean().default(true),
  billExtracts: z.boolean().default(false),
  extractPriceMicros: z.number().int().min(0).max(1_000_000_000).default(4_000),
})

export const firecrawlWebProviderSettingsSchema = z.object({
  searchEnabled: z.boolean().default(false),
  billSearches: z.boolean().default(false),
  searchPriceMicros: z.number().int().min(0).max(1_000_000_000).default(12_000),
  extractEnabled: z.boolean().default(false),
  billExtracts: z.boolean().default(false),
  extractPriceMicros: z.number().int().min(0).max(1_000_000_000).default(4_000),
  baseUrl: z.url().default('https://api.firecrawl.dev/v2'),
  maxAgeSeconds: z.number().int().min(0).max(31_536_000).default(0),
})

export const webToolsSettingsSchema = z.object({
  searchEnabled: z.boolean().default(false),
  extractEnabled: z.boolean().default(false),
  searchProviderOrder: webToolProviderOrderSchema.default(['kagi', 'firecrawl']),
  extractProviderOrder: webToolProviderOrderSchema.default(['kagi', 'firecrawl']),
  kagi: kagiWebProviderSettingsSchema.default({
    searchEnabled: true,
    billSearches: false,
    searchPriceMicros: 12_000,
    extractEnabled: true,
    billExtracts: false,
    extractPriceMicros: 4_000,
  }),
  firecrawl: firecrawlWebProviderSettingsSchema.default({
    searchEnabled: false,
    billSearches: false,
    searchPriceMicros: 12_000,
    extractEnabled: false,
    billExtracts: false,
    extractPriceMicros: 4_000,
    baseUrl: 'https://api.firecrawl.dev/v2',
    maxAgeSeconds: 0,
  }),
})
export type WebToolsSettings = z.infer<typeof webToolsSettingsSchema>

export const managementScopeSchema = z.enum([
  'account:read',
  'account:write',
  'instance:read',
  'instance:write',
  'catalog:read',
  'catalog:write',
  'users:read',
  'users:write',
  'usage:read',
  'audit:read',
  'operations:read',
  'operations:write',
])
export type ManagementScope = z.infer<typeof managementScopeSchema>

export const createManagementTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(managementScopeSchema).min(1).transform((scopes) => [...new Set(scopes)]),
  expiresInDays: z.number().int().min(1).max(365).default(90),
})

export const managementTokenSchema = z.object({
  id: idSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(managementScopeSchema),
  expiresAt: isoDateSchema,
  lastUsedAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
})
export type ManagementToken = z.infer<typeof managementTokenSchema>

export const authSettingsSchema = z.object({
  signupEnabled: z.boolean().default(true),
  defaultBalanceMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(5_000_000),
  defaultStorageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(5_000 * 1024 * 1024),
  maxAttachmentBytes: z.number().int().nonnegative().max(MAX_CONFIGURABLE_ATTACHMENT_BYTES).default(DEFAULT_MAX_ATTACHMENT_BYTES),
  pendingDetails: z.boolean().default(true),
  adminEmail: z.union([z.literal(''), z.email()]).default(''),
  pendingMessage: z.string().max(2_000).default('Your account is pending approval. An admin will review it shortly.'),
  defaultSignupRole: z.enum(['pending', 'user']).default('pending'),
  apiKeysEnabled: z.boolean().default(true),
  newAccountModelDefaults: newAccountModelDefaultsSchema.default(() => newAccountModelDefaultsSchema.parse({})),
})

export const DEFAULT_TITLE_PROMPT = `### Task:
Generate a concise, 3-5 word title with an emoji summarizing the chat history.
### Guidelines:
- The title should clearly represent the main theme or subject of the conversation.
- Use emojis that enhance understanding of the topic, but avoid quotation marks or special formatting.
- Use an emoji as the first character of the title
- Write the title in the chat's primary language; default to English if multilingual.
- Prioritize accuracy over excessive creativity; keep it clear and simple.
### Output:
JSON format: { "title": "your concise title here" }
### Examples:
- { "title": "📉 Stock Market Trends" },
- { "title": "🍪 Perfect Chocolate Chip Recipe" },
- { "title": "🎶 Evolution of Music Streaming" },
- { "title": "💻 Remote Work Productivity Tips" },
- { "title": "👀 Artificial Intelligence in Healthcare" },
- { "title": "🎮 Video Game Development Insights" }`

export const suggestedPromptItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4_000),
})

export const DEFAULT_SUGGESTED_PROMPTS = [
  { id: '1', label: 'What can you help me build today?', message: 'What can you help me build today?' },
  { id: '2', label: 'Explain how KV caching speeds up decoding', message: 'Explain how KV caching speeds up decoding' },
  { id: '3', label: 'Draft a terse commit message for a sidebar refactor', message: 'Draft a terse commit message for a sidebar refactor' },
  { id: '4', label: 'Compare mixture-of-experts vs dense models', message: 'Compare mixture-of-experts vs dense models' },
] as const

export const interfaceSettingsSchema = z.object({
  localTask: z.string().min(1).max(200).default('current'),
  title: z.boolean().default(true),
  titlePrompt: z.string().max(10_000).default(DEFAULT_TITLE_PROMPT),
  titleIncludeFirstCharacters: z.number().int().min(0).max(1_000_000).default(8_000),
  titleIncludeLastCharacters: z.number().int().min(0).max(1_000_000).default(8_000),
  followUp: z.boolean().default(true),
  suggestedPromptsEnabled: z.boolean().default(true),
  suggestedPromptsCount: z.number().int().min(0).max(12).default(4),
  suggestedPrompts: z.array(suggestedPromptItemSchema).max(50).default([...DEFAULT_SUGGESTED_PROMPTS]),
})

export const instanceOcrSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  cacheEnabled: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().min(60).max(31_536_000).default(3_600),
  modelId: z.string().min(1).max(200).nullable().default(null),
  systemPrompt: z.string().max(100_000).default(DEFAULT_OCR_SYSTEM_PROMPT),
})

const accountPreferenceIdsSchema = z.array(z.string().trim().min(1).max(200)).max(500)
  .transform((ids) => [...new Set(ids)])

export const automaticChatExpirationSchema = z.enum(['disabled', '24h', '7d'])
export type AutomaticChatExpiration = z.infer<typeof automaticChatExpirationSchema>
export const newChatAutoExpireSchema = z.boolean().default(true)

export const managementAccountSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  language: z.string().min(1).max(32).default('en-US'),
  sendWithEnter: z.boolean().default(true),
  streamResponses: z.boolean().default(true),
  showReasoning: z.boolean().default(true),
  chatWidth: z.enum(['full', 'narrow']).default('narrow'),
  customInstructions: z.string().max(100_000).default(''),
  nickname: z.string().max(80).default(''),
  memoryEnabled: z.boolean().default(false),
  agentModeEnabled: z.boolean().default(true),
  leaderboardVisible: z.boolean().default(false),
  leaderboardColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#10b981'),
  localChatLimit: z.number().int().min(0).max(500).default(50),
  localAttachmentCacheMb: z.number().int().min(0).max(2_048).default(50),
  trashRetention: z.enum(['instant', '24h', '7d', '30d', '90d', 'indefinite']).default('30d'),
  automaticChatExpiration: automaticChatExpirationSchema.default('disabled'),
  newChatAutoExpire: newChatAutoExpireSchema,
  defaultModelId: z.string().max(120).nullable().default(null),
  generation: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  favoriteModelIds: accountPreferenceIdsSchema.default([]),
  providerOrder: accountPreferenceIdsSchema.default([]),
})

export const managementWebToolsSettingsSchema = webToolsSettingsSchema.extend({
  apiKey: z.union([
    z.object({ configured: z.literal(true) }),
    z.object({ fromEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }),
    z.object({ clear: z.literal(true) }),
  ]).optional(),
})

export const managementInstanceSettingsSchema = z.object({
  auth: authSettingsSchema.default(() => authSettingsSchema.parse({})),
  interface: interfaceSettingsSchema.default(() => interfaceSettingsSchema.parse({})),
  ocr: instanceOcrSettingsSchema.default(() => instanceOcrSettingsSchema.parse({})),
  agent: agentSettingsSchema.default(() => agentSettingsSchema.parse({})),
  webTools: managementWebToolsSettingsSchema.default(() => managementWebToolsSettingsSchema.parse({})),
  logging: loggingSettingsSchema.default(() => loggingSettingsSchema.parse({})),
})

export const managementSettingsDocumentSchema = z.object({
  apiVersion: z.literal('pulpo.dev/management/v1'),
  kind: z.literal('Settings'),
  revision: z.string().min(1),
  account: managementAccountSettingsSchema,
  instance: managementInstanceSettingsSchema,
})
export type ManagementSettingsDocument = z.infer<typeof managementSettingsDocumentSchema>

export const managementAccountSettingsDocumentSchema = z.object({
  apiVersion: z.literal('pulpo.dev/management/v1'),
  kind: z.literal('AccountSettings'),
  revision: z.string().min(1),
  account: managementAccountSettingsSchema,
})
export type ManagementAccountSettingsDocument = z.infer<typeof managementAccountSettingsDocumentSchema>

export const managementInstanceSettingsDocumentSchema = z.object({
  apiVersion: z.literal('pulpo.dev/management/v1'),
  kind: z.literal('InstanceSettings'),
  revision: z.string().min(1),
  instance: managementInstanceSettingsSchema,
})
export type ManagementInstanceSettingsDocument = z.infer<typeof managementInstanceSettingsDocumentSchema>

export const managementSettingsChangeSchema = z.object({
  path: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
})
export type ManagementSettingsChange = z.infer<typeof managementSettingsChangeSchema>

export const managementSettingsPlanSchema = z.object({
  revision: z.string().min(1),
  changes: z.array(managementSettingsChangeSchema),
  document: managementSettingsDocumentSchema,
})
export type ManagementSettingsPlan = z.infer<typeof managementSettingsPlanSchema>

export const managementInfoSchema = z.object({
  managementApiVersion: z.literal(1),
  instance: z.object({
    name: z.string(),
    version: z.string(),
    publicUrl: z.url(),
  }),
  deployment: z.object({
    storageDriver: z.enum(['local', 's3']),
    databaseConfigured: z.boolean(),
    redisConfigured: z.boolean(),
    s3Configured: z.boolean(),
    encryptionConfigured: z.boolean(),
    cookieSecure: z.boolean(),
    smtpConfigured: z.boolean(),
    workspaceControllerConfigured: z.boolean(),
  }),
  capabilities: z.array(z.string()),
})
export type ManagementInfo = z.infer<typeof managementInfoSchema>

export const adminUsageStatusSchema = z.enum(['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'])
export const adminUsageEventSchema = z.object({
  requestId: idSchema,
  responseId: idSchema,
  status: adminUsageStatusSchema,
  elapsedMs: z.number().int().nonnegative(),
  currentModelId: z.string().nullable(),
  retryAttempt: z.number().int().nonnegative(),
  turnNumber: z.number().int().positive().nullable(),
  retryCount: z.number().int().nonnegative(),
  fallbackUsed: z.boolean(),
  ocrStatus: z.string(),
  eventCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  updatedAt: isoDateSchema,
})
export type AdminUsageEvent = z.infer<typeof adminUsageEventSchema>

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
  sortOrder: z.number().int().optional(),
  temporary: z.boolean(),
  expiresAt: isoDateSchema.nullable().optional(),
  updatedAt: isoDateSchema,
  activeResponseId: idSchema.nullable(),
  inFlightResponseIds: z.array(idSchema).default([]),
})
export type ChatSummary = z.infer<typeof chatSummarySchema>

export const persistChatResponseSchema = chatSummarySchema.extend({
  temporary: z.literal(false),
  expiresAt: z.null(),
})
export type PersistChatResponse = z.infer<typeof persistChatResponseSchema>

export const createChatSchema = z.object({
  clientId: idSchema.optional(),
  modelId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  temporary: z.boolean().default(false),
  autoExpire: z.boolean().default(false),
})

export const updateChatSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  folderId: idSchema.nullable().optional(),
  modelId: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  autoExpire: z.boolean().optional(),
})
export type UpdateChatInput = z.infer<typeof updateChatSchema>

const attachmentIdListSchema = z.array(idSchema).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: 'Attachment ids must be unique' },
)

export const createChatResponseSchema = z.object({
  clientId: idSchema.optional(),
  parentResponseId: idSchema.nullable().optional(),
  input: z.string().trim().max(1_000_000).default(''),
  modelId: z.string().min(1),
  executionMode: executionModeSchema.optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  presetSelections: z.record(z.string(), z.string()).default({}),
  attachmentIds: attachmentIdListSchema.default([]),
  agentMode: z.boolean().default(false),
}).refine((value) => value.input.length > 0 || value.attachmentIds.length > 0, {
  message: 'Message must include text or attachments',
  path: ['input'],
})
export type CreateChatResponseInput = z.infer<typeof createChatResponseSchema>

export const editMessageSchema = z.object({
  clientId: idSchema.optional(),
  content: z.string().trim().max(1_000_000),
  modelId: z.string().trim().min(1).optional(),
  presetSelections: z.record(z.string(), z.string()).optional(),
  attachmentIds: attachmentIdListSchema.optional(),
  agentMode: z.boolean().optional(),
})
export type EditMessageInput = z.infer<typeof editMessageSchema>

export const queuedMessageStatusSchema = z.enum(['pending', 'editing', 'dispatching', 'failed'])
export type QueuedMessageStatus = z.infer<typeof queuedMessageStatusSchema>

export const queuedMessageAttachmentSchema = z.object({
  id: idSchema,
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
})
export type QueuedMessageAttachment = z.infer<typeof queuedMessageAttachmentSchema>

export const queuedMessageSchema = z.object({
  id: idSchema,
  chatId: idSchema,
  content: z.string(),
  modelId: z.string(),
  presetSelections: z.record(z.string(), z.string()),
  agentMode: z.boolean(),
  position: z.number().int().nonnegative(),
  status: queuedMessageStatusSchema,
  error: z.string().nullable(),
  attachments: z.array(queuedMessageAttachmentSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type QueuedMessage = z.infer<typeof queuedMessageSchema>

export const createQueuedMessageSchema = z.object({
  input: z.string().trim().max(1_000_000).default(''),
  modelId: z.string().min(1),
  presetSelections: z.record(z.string(), z.string()).default({}),
  attachmentIds: attachmentIdListSchema.default([]),
  agentMode: z.boolean().default(false),
}).refine((value) => value.input.length > 0 || value.attachmentIds.length > 0, {
  message: 'Message must include text or attachments',
  path: ['input'],
})
export type CreateQueuedMessageInput = z.infer<typeof createQueuedMessageSchema>

export const updateQueuedMessageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('begin_edit') }),
  z.object({ action: z.literal('cancel_edit') }),
  z.object({
    action: z.literal('save_edit'),
    input: z.string().trim().max(1_000_000).default(''),
    modelId: z.string().min(1),
    presetSelections: z.record(z.string(), z.string()).default({}),
    attachmentIds: attachmentIdListSchema.default([]),
    agentMode: z.boolean().default(false),
  }).refine((value) => value.input.length > 0 || value.attachmentIds.length > 0, {
    message: 'Message must include text or attachments',
    path: ['input'],
  }),
])
export type UpdateQueuedMessageInput = z.infer<typeof updateQueuedMessageSchema>

export const startChatSchema = z.object({
  chat: createChatSchema.extend({ clientId: idSchema }),
  response: createChatResponseSchema.safeExtend({ clientId: idSchema }),
})
export type StartChatInput = z.infer<typeof startChatSchema>

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
  'admin.usage.subscribe': () => void
  'admin.usage.unsubscribe': () => void
}

export interface ServerToClientEvents {
  'response.event': (event: ResponseEvent) => void
  'response.snapshot': (snapshot: ResponseSnapshot) => void
  'response.completed': (input: { responseId: string; chatId: string; preview: string }) => void
  'chat.changed': (input: { chatId: string; revision: number }) => void
  'account.revision': (input: { revision: number }) => void
  'usage.changed': (input: { balanceMicros: number; spentThisMonthMicros: number }) => void
  'sync.result': (result: SyncResult) => void
  'admin.usage.upsert': (event: z.infer<typeof adminUsageEventSchema>) => void
}
