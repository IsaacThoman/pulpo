import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
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

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('pending'),
  balanceMicros: bigint('balance_micros', { mode: 'number' }).notNull().default(0),
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
  ...timestamps,
})

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
  contextWindow: integer('context_window').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  executionMode: executionModeEnum('execution_mode').notNull().default('stream'),
  tags: jsonb('tags').notNull().default([]),
  allowedParameters: jsonb('allowed_parameters').notNull().default([]),
  fallbackModelId: text('fallback_model_id'),
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
  ...timestamps,
}, (table) => [index('chats_user_updated_idx').on(table.userId, table.updatedAt)])

export const responses = pgTable('responses', {
  id: uuid('id').primaryKey(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => models.id),
  pricingVersionId: uuid('pricing_version_id').references(() => modelPricingVersions.id),
  openaiResponseId: text('openai_response_id'),
  previousResponseId: uuid('previous_response_id'),
  parentResponseId: uuid('parent_response_id'),
  status: responseStatusEnum('status').notNull().default('queued'),
  executionMode: executionModeEnum('execution_mode').notNull().default('stream'),
  input: jsonb('input').notNull(),
  instructions: text('instructions'),
  presetSelections: jsonb('preset_selections').notNull().default({}),
  output: jsonb('output').notNull().default([]),
  usage: jsonb('usage'),
  error: jsonb('error'),
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
  upstreamSequence: bigint('upstream_sequence', { mode: 'number' }).notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
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

export const messageFeedback = pgTable('message_feedback', {
  responseItemId: uuid('response_item_id').notNull().references(() => responseItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: text('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.responseItemId, table.userId] })])

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
  error: text('error'),
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

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('notifications_user_created_idx').on(table.userId, table.createdAt)])

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
  responseId: uuid('response_id').references(() => responses.id),
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
  responseId: uuid('response_id').notNull().references(() => responses.id),
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
