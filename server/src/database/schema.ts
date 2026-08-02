import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const roleEnum = pgEnum('user_role', ['pending', 'user', 'admin'])
export const responseStatusEnum = pgEnum('response_status', [
  'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete',
])
export const executionModeEnum = pgEnum('execution_mode', ['stream', 'background'])
export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'ready', 'failed', 'deleted'])
export const apiKeyStatusEnum = pgEnum('api_key_status', ['active', 'revoked'])
export const reservationStatusEnum = pgEnum('reservation_status', ['pending', 'settled', 'released'])
export const workspaceLeaseStatusEnum = pgEnum('workspace_lease_status', ['provisioning', 'ready', 'expired', 'failed', 'released'])
export const agentRunStatusEnum = pgEnum('agent_run_status', ['queued', 'running', 'completed', 'failed', 'cancelled'])
export const toolExecutionStatusEnum = pgEnum('tool_execution_status', ['queued', 'running', 'completed', 'failed', 'cancelled'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('pending'),
  balanceMicros: bigint('balance_micros', { mode: 'number' }).notNull().default(0),
  storageLimitBytes: bigint('storage_limit_bytes', { mode: 'number' }).notNull().default(5_242_880_000),
  blocked: boolean('blocked').notNull().default(false),
  stateRevision: bigint('state_revision', { mode: 'number' }).notNull().default(0),
  leaderboardVisible: boolean('leaderboard_visible').notNull().default(true),
  leaderboardColor: text('leaderboard_color').notNull().default('#71717a'),
  nickname: text('nickname'),
  ...timestamps,
}, (table) => [uniqueIndex('users_email_unique').on(sql`lower(${table.email})`)])

export const passwordCredentials = pgTable('password_credentials', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash), index('sessions_user_idx').on(table.userId)])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  values: jsonb('values').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('audit_target_idx').on(table.targetType, table.targetId)])

export const providerConnections = pgTable('provider_connections', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('openai'),
  baseUrl: text('base_url').notNull().default('https://api.openai.com/v1'),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  organizationId: text('organization_id'),
  projectId: text('project_id'),
  requestTimeoutMs: integer('request_timeout_ms').notNull().default(120_000),
  enabled: boolean('enabled').notNull().default(true),
  lastHealthStatus: text('last_health_status'),
  lastHealthAt: timestamp('last_health_at', { withTimezone: true }),
  upstreamModelsSyncedAt: timestamp('upstream_models_synced_at', { withTimezone: true }),
  ...timestamps,
})

export const providerUpstreamModels = pgTable('provider_upstream_models', {
  providerConnectionId: uuid('provider_connection_id').notNull().references(() => providerConnections.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.providerConnectionId, table.modelId] }),
  index('provider_upstream_models_provider_idx').on(table.providerConnectionId),
])

export const labs = pgTable('labs', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  logo: text('logo').notNull(),
  ...timestamps,
})

export const models = pgTable('models', {
  id: text('id').primaryKey(),
  providerConnectionId: uuid('provider_connection_id').notNull().references(() => providerConnections.id),
  labId: uuid('lab_id').references(() => labs.id, { onDelete: 'set null' }),
  upstreamModelId: text('upstream_model_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  visible: boolean('visible').notNull().default(true),
  logo: text('logo'),
  systemPrompt: text('system_prompt').notNull().default(''),
  agentEnabled: boolean('agent_enabled').notNull().default(false),
  agentInstructions: text('agent_instructions').notNull().default(''),
  defaultParameters: jsonb('default_parameters').notNull().default({}),
  interceptImagesWithOcr: boolean('intercept_images_with_ocr').notNull().default(false),
  contextWindow: integer('context_window').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  executionMode: executionModeEnum('execution_mode').notNull().default('stream'),
  tags: jsonb('tags').notNull().default([]),
  allowedParameters: jsonb('allowed_parameters').notNull().default([]),
  fallbackModelId: text('fallback_model_id'),
  maxRetries: integer('max_retries').notNull().default(0),
  retryDelaySeconds: integer('retry_delay_seconds').notNull().default(1),
  stickyFallbackSeconds: integer('sticky_fallback_seconds').notNull().default(0),
  firstTokenTimeoutEnabled: boolean('first_token_timeout_enabled').notNull().default(false),
  firstTokenTimeoutSeconds: integer('first_token_timeout_seconds').notNull().default(30),
  slowStickyEnabled: boolean('slow_sticky_enabled').notNull().default(false),
  slowStickyMinTokensPerSecond: doublePrecision('slow_sticky_min_tokens_per_second').notNull().default(5),
  slowStickyMinCompletionSeconds: integer('slow_sticky_min_completion_seconds').notNull().default(30),
  iconLight: text('icon_light'),
  iconDark: text('icon_dark'),
  ...timestamps,
})

export const modelPricingVersions = pgTable('model_pricing_versions', {
  id: uuid('id').primaryKey(),
  modelId: text('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
  inputPriceMicros: bigint('input_price_micros', { mode: 'number' }).notNull(),
  cachedInputPriceMicros: bigint('cached_input_price_micros', { mode: 'number' }).notNull(),
  outputPriceMicros: bigint('output_price_micros', { mode: 'number' }).notNull(),
  perRequestPriceMicros: bigint('per_request_price_micros', { mode: 'number' }).notNull().default(0),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('pricing_model_effective_idx').on(table.modelId, table.effectiveFrom)])

export const modelPresets = pgTable('model_presets', {
  id: uuid('id').primaryKey(),
  modelId: text('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
  publicId: text('public_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  defaultChoiceId: uuid('default_choice_id'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [uniqueIndex('preset_model_public_unique').on(table.modelId, table.publicId)])

export const modelPresetChoices = pgTable('model_preset_choices', {
  id: uuid('id').primaryKey(),
  presetId: uuid('preset_id').notNull().references(() => modelPresets.id, { onDelete: 'cascade' }),
  publicId: text('public_id').notNull(),
  displayName: text('display_name').notNull(),
  icon: text('icon'),
  actionType: text('action_type').notNull().default('none'),
  action: jsonb('action').notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [uniqueIndex('choice_preset_public_unique').on(table.presetId, table.publicId)])

export const providerHealthChecks = pgTable('provider_health_checks', {
  id: uuid('id').primaryKey(),
  providerConnectionId: uuid('provider_connection_id').notNull().references(() => providerConnections.id, { onDelete: 'cascade' }),
  success: boolean('success').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
})

export const chats = pgTable('chats', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  title: text('title').notNull().default('New chat'),
  modelId: text('model_id').notNull().references(() => models.id),
  pinned: boolean('pinned').notNull().default(false),
  temporary: boolean('temporary').notNull().default(false),
  activeBranchLeafId: uuid('active_branch_leaf_id'),
  activeResponseId: uuid('active_response_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgeStartedAt: timestamp('purge_started_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [index('chats_user_updated_idx').on(table.userId, table.updatedAt)])

export const responses = pgTable('responses', {
  id: uuid('id').primaryKey(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => models.id),
  actualModelId: text('actual_model_id').references(() => models.id),
  origin: text('origin').notNull().default('web'),
  pricingVersionId: uuid('pricing_version_id').references(() => modelPricingVersions.id),
  openaiResponseId: text('openai_response_id'),
  previousResponseId: uuid('previous_response_id'),
  parentResponseId: uuid('parent_response_id'),
  userMessageId: uuid('user_message_id'),
  branchReason: text('branch_reason').notNull().default('message'),
  status: responseStatusEnum('status').notNull().default('queued'),
  executionMode: executionModeEnum('execution_mode').notNull().default('stream'),
  agentMode: boolean('agent_mode').notNull().default(false),
  agentCapacityAction: text('agent_capacity_action'),
  input: jsonb('input').notNull(),
  instructions: text('instructions'),
  presetSelections: jsonb('preset_selections').notNull().default({}),
  parameters: jsonb('parameters').notNull().default({}),
  output: jsonb('output').notNull().default([]),
  usage: jsonb('usage'),
  error: jsonb('error'),
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
  upstreamSequence: bigint('upstream_sequence', { mode: 'number' }).notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index('responses_chat_created_idx').on(table.chatId, table.createdAt),
  uniqueIndex('responses_user_idempotency_unique').on(table.userId, table.idempotencyKey),
])

export const responseItems = pgTable('response_items', {
  id: uuid('id').primaryKey(),
  responseId: uuid('response_id').notNull().references(() => responses.id, { onDelete: 'cascade' }),
  upstreamItemId: text('upstream_item_id'),
  type: text('type').notNull(),
  role: text('role'),
  status: text('status'),
  position: integer('position').notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [uniqueIndex('response_items_position_unique').on(table.responseId, table.position)])

export const responseContentParts = pgTable('response_content_parts', {
  id: uuid('id').primaryKey(),
  responseItemId: uuid('response_item_id').notNull().references(() => responseItems.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  position: integer('position').notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [uniqueIndex('content_parts_position_unique').on(table.responseItemId, table.position)])

export const chatShares = pgTable('chat_shares', {
  id: uuid('id').primaryKey(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('share_token_unique').on(table.tokenHash)])

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
  status: attachmentStatusEnum('status').notNull().default('pending'),
  objectKey: text('object_key').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  checksum: text('checksum'),
  openaiFileId: text('openai_file_id'),
  origin: text('origin').notNull().default('user'),
  sourceResponseId: uuid('source_response_id').references(() => responses.id, { onDelete: 'set null' }),
  sourceToolCallId: text('source_tool_call_id'),
  error: text('error'),
  ...timestamps,
}, (table) => [
  index('attachments_user_status_idx').on(table.userId, table.status),
  uniqueIndex('attachments_response_tool_unique').on(table.sourceResponseId, table.sourceToolCallId),
])

export const workspaceLeases = pgTable('workspace_leases', {
  id: uuid('id').primaryKey(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  responseId: uuid('response_id').references(() => responses.id, { onDelete: 'set null' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  controllerLeaseId: text('controller_lease_id'),
  status: workspaceLeaseStatusEnum('status').notNull().default('provisioning'),
  capacityState: text('capacity_state'),
  imageDigest: text('image_digest').notNull(),
  error: text('error'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  hardExpiresAt: timestamp('hard_expires_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex('workspace_leases_chat_active_unique').on(table.chatId).where(sql`${table.status} in ('provisioning', 'ready')`), index('workspace_leases_expiry_idx').on(table.expiresAt), index('workspace_leases_queue_idx').on(table.capacityState, table.createdAt)])

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey(),
  responseId: uuid('response_id').notNull().references(() => responses.id, { onDelete: 'cascade' }),
  workspaceLeaseId: uuid('workspace_lease_id').references(() => workspaceLeases.id, { onDelete: 'set null' }),
  status: agentRunStatusEnum('status').notNull().default('queued'),
  context: jsonb('context').notNull().default({}),
  modelTurns: integer('model_turns').notNull().default(0),
  toolCalls: integer('tool_calls').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex('agent_runs_response_unique').on(table.responseId)])

export const toolExecutions = pgTable('tool_executions', {
  id: uuid('id').primaryKey(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  workspaceLeaseId: uuid('workspace_lease_id').references(() => workspaceLeases.id, { onDelete: 'set null' }),
  operationId: text('operation_id').notNull(),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments').notNull().default({}),
  status: toolExecutionStatusEnum('status').notNull().default('queued'),
  output: text('output'),
  exitCode: integer('exit_code'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex('tool_executions_operation_unique').on(table.operationId), index('tool_executions_run_idx').on(table.agentRunId, table.createdAt)])

export const requestLogs = pgTable('request_logs', {
  id: uuid('id').primaryKey(),
  responseId: uuid('response_id').notNull().references(() => responses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  origin: text('origin').notNull().default('web'),
  status: responseStatusEnum('status').notNull().default('queued'),
  requestedModelId: text('requested_model_id').notNull().references(() => models.id),
  actualModelId: text('actual_model_id').references(() => models.id),
  currentModelId: text('current_model_id').references(() => models.id),
  currentRetryAttempt: integer('current_retry_attempt').notNull().default(0),
  currentTurnNumber: integer('current_turn_number'),
  retryCount: integer('retry_count').notNull().default(0),
  fallbackUsed: boolean('fallback_used').notNull().default(false),
  stickyFallbackUsed: boolean('sticky_fallback_used').notNull().default(false),
  ocrStatus: text('ocr_status').notNull().default('not_requested'),
  errorCategory: text('error_category'),
  errorMessage: text('error_message'),
  inputTokens: integer('input_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  durationMs: integer('duration_ms'),
  tokensPerSecond: doublePrecision('tokens_per_second'),
  eventCount: integer('event_count').notNull().default(0),
  requestPayload: jsonb('request_payload'),
  responsePayload: jsonb('response_payload'),
  payloadExpiresAt: timestamp('payload_expires_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex('request_logs_response_unique').on(table.responseId),
  index('request_logs_created_idx').on(table.createdAt),
  index('request_logs_status_idx').on(table.status),
])

export const generationAttempts = pgTable('generation_attempts', {
  id: uuid('id').primaryKey(),
  requestLogId: uuid('request_log_id').notNull().references(() => requestLogs.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => models.id),
  upstreamModelId: text('upstream_model_id'),
  source: text('source').notNull().default('web'),
  purpose: text('purpose').notNull().default('generation'),
  retryAttempt: integer('retry_attempt').notNull().default(1),
  turnNumber: integer('turn_number'),
  status: text('status').notNull().default('in_progress'),
  retryReason: text('retry_reason'),
  fallbackFromModelId: text('fallback_from_model_id').references(() => models.id),
  upstreamResponseId: text('upstream_response_id'),
  errorCategory: text('error_category'),
  errorMessage: text('error_message'),
  firstTokenMs: integer('first_token_ms'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [index('generation_attempts_log_idx').on(table.requestLogId, table.startedAt)])

export const ocrAttempts = pgTable('ocr_attempts', {
  id: uuid('id').primaryKey(),
  requestLogId: uuid('request_log_id').notNull().references(() => requestLogs.id, { onDelete: 'cascade' }),
  attachmentId: uuid('attachment_id').references(() => attachments.id, { onDelete: 'set null' }),
  sourceChecksum: text('source_checksum'),
  providerId: uuid('provider_id').references(() => providerConnections.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  status: text('status').notNull().default('in_progress'),
  cached: boolean('cached').notNull().default(false),
  errorMessage: text('error_message'),
  requestPayload: jsonb('request_payload'),
  responsePayload: jsonb('response_payload'),
  durationMs: integer('duration_ms'),
  ...timestamps,
})

export const ocrCacheEntries = pgTable('ocr_cache_entries', {
  checksum: text('checksum').primaryKey(),
  providerFingerprint: text('provider_fingerprint').notNull(),
  text: text('text').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('ocr_cache_expiry_idx').on(table.expiresAt)])

export const chatImportSources = pgTable('chat_import_sources', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  sourceChatId: text('source_chat_id').notNull(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.source, table.sourceChatId] }),
  index('chat_import_fingerprint_idx').on(table.userId, table.source, table.fingerprint),
])

export const backupJobs = pgTable('backup_jobs', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  operation: text('operation').notNull(),
  status: text('status').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  objectKey: text('object_key'),
  originalName: text('original_name'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...timestamps,
})

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  sourceChatId: uuid('source_chat_id').references(() => chats.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  ...timestamps,
})

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  secretHash: text('secret_hash').notNull(),
  status: apiKeyStatusEnum('status').notNull().default('active'),
  scopes: jsonb('scopes').notNull().default([]),
  monthlyBudgetMicros: bigint('monthly_budget_micros', { mode: 'number' }),
  lifetimeBudgetMicros: bigint('lifetime_budget_micros', { mode: 'number' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('api_key_prefix_unique').on(table.prefix)])

export const apiKeyModelPermissions = pgTable('api_key_model_permissions', {
  apiKeyId: uuid('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
}, (table) => [primaryKey({ columns: [table.apiKeyId, table.modelId] })])

export const budgetReservations = pgTable('budget_reservations', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
  responseId: uuid('response_id').notNull().references(() => responses.id, { onDelete: 'cascade' }),
  amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
  settledAmountMicros: bigint('settled_amount_micros', { mode: 'number' }),
  status: reservationStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (table) => [uniqueIndex('reservation_response_unique').on(table.responseId)])

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  responseId: uuid('response_id').references(() => responses.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
  balanceAfterMicros: bigint('balance_after_micros', { mode: 'number' }).notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('ledger_user_created_idx').on(table.userId, table.createdAt)])

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
  responseId: uuid('response_id').references(() => responses.id, { onDelete: 'set null' }),
  modelId: text('model_id').notNull().references(() => models.id),
  pricingVersionId: uuid('pricing_version_id').references(() => modelPricingVersions.id),
  inputTokens: integer('input_tokens').notNull(),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull(),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
  latencyMs: integer('latency_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('usage_response_unique').on(table.responseId), index('usage_user_created_idx').on(table.userId, table.createdAt)])

export const dailyUsageRollups = pgTable('daily_usage_rollups', {
  day: timestamp('day', { withTimezone: true }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  modelId: text('model_id').notNull().references(() => models.id),
  calls: integer('calls').notNull(),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull(),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull(),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
}, (table) => [primaryKey({ columns: [table.day, table.userId, table.modelId] })])

export const applicationSettings = pgTable('application_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const banners = pgTable('banners', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(),
  content: text('content').notNull(),
  dismissible: boolean('dismissible').notNull().default(true),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const exportJobs = pgTable('export_jobs', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  status: text('status').notNull().default('queued'),
  objectKey: text('object_key'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...timestamps,
})

export const idempotencyRecords = pgTable('idempotency_records', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  operation: text('operation').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.key, table.operation] })])
