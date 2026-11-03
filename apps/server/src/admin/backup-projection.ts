import { FULL_BACKUP_TABLES, type FullBackupTable } from './backup-format.js'

export type FullBackupRow = Record<string, unknown>
export type FullBackupDatabase = Record<FullBackupTable, FullBackupRow[]>

type TemporaryDataPolicy =
  | 'preserve'
  | 'chat'
  | 'response'
  | 'response-reference'
  | 'response-item'
  | 'response-content-part'
  | 'chat-reference'
  | 'attachment'
  | 'redact-source-response'
  | 'redact-response'
  | 'chat-turn-embedding'
  | 'request-log'
  | 'generation-attempt'
  | 'ocr-attempt'
  | 'ocr-cache'
  | 'workspace-lease'
  | 'agent-run'
  | 'tool-execution'
  | 'composer-draft'
  | 'composer-draft-attachment'
  | 'shelved-draft'
  | 'shelved-draft-attachment'
  | 'queued-message'

/**
 * Every durable backup table must explicitly declare how temporary-chat data
 * is handled. Adding a table to FULL_BACKUP_TABLES without classifying it is a
 * compile-time error.
 */
export const FULL_BACKUP_TEMPORARY_DATA_POLICY = {
  users: 'preserve',
  friendships: 'preserve',
  user_blocks: 'preserve',
  pools: 'preserve', pool_members: 'preserve', pool_invitations: 'preserve', invite_codes: 'preserve',
  password_credentials: 'preserve',
  user_passkey_credentials: 'preserve', user_provider_credentials: 'preserve',
  user_totp_credentials: 'preserve',
  two_factor_recovery_codes: 'preserve',
  user_preferences: 'preserve',
  audit_events: 'preserve',
  catalog_icons: 'preserve',
  labs: 'preserve',
  provider_connections: 'preserve',
  image_models: 'preserve',
  image_generation_requests: 'response-reference',
  speech_models: 'preserve',
  speech_requests: 'preserve',
  speech_resource_cleanup: 'preserve',
  models: 'preserve',
  model_user_grants: 'preserve',
  model_pricing_versions: 'preserve',
  model_presets: 'preserve',
  model_preset_choices: 'preserve',
  chats: 'chat',
  responses: 'response',
  response_items: 'response-item',
  response_content_parts: 'response-content-part',
  chat_shares: 'chat-reference',
  message_reports: 'chat-reference',
  attachments: 'attachment',
  user_memory_documents: 'redact-source-response',
  user_memory_document_revisions: 'redact-source-response',
  file_nodes: 'preserve', file_docs: 'preserve', file_doc_updates: 'preserve', file_folder_layouts: 'preserve',
  queued_messages: 'queued-message', composer_drafts: 'composer-draft', composer_draft_attachments: 'composer-draft-attachment',
  shelved_drafts: 'shelved-draft', shelved_draft_attachments: 'shelved-draft-attachment', shelf_operations: 'preserve',
  episodic_memory_generations: 'preserve',
  chat_turn_embeddings: 'chat-turn-embedding',
  episodic_memory_metric_buckets: 'preserve',
  api_keys: 'preserve',
  management_tokens: 'preserve',
  api_key_model_permissions: 'preserve',
  credit_ledger: 'redact-response',
  usage_events: 'redact-response',
  daily_usage_rollups: 'preserve',
  application_settings: 'preserve',
  banners: 'preserve',
  request_logs: 'request-log',
  generation_attempts: 'generation-attempt',
  diagnostic_policy: 'preserve',
  provider_diagnostics: 'generation-attempt',
  ocr_attempts: 'ocr-attempt',
  ocr_cache_entries: 'ocr-cache',
  chat_import_sources: 'chat-reference',
  workspace_leases: 'workspace-lease',
  agent_runs: 'agent-run',
  tool_executions: 'tool-execution',
  billing_accounts: 'preserve', billing_subscriptions: 'preserve', billing_checkouts: 'preserve', billing_auto_top_ups: 'preserve', billing_orders: 'preserve', billing_webhook_events: 'preserve', billing_custom_limits: 'preserve', custom_limit_spend: 'preserve',
  weekly_usage_periods: 'preserve', daily_usage_periods: 'preserve', five_hour_usage_periods: 'preserve', shared_allowance_periods: 'preserve', shared_five_hour_usage_periods: 'preserve',
  request_analytics: 'redact-response', request_analytics_tools: 'preserve', analytics_hourly_rollups: 'preserve', idempotency_records: 'preserve',
} as const satisfies Record<FullBackupTable, TemporaryDataPolicy>

export interface BackupAttachmentBlob {
  objectKey: string
  checksum: string | null
}

export interface FullBackupProjection {
  database: FullBackupDatabase
  attachmentBlobs: BackupAttachmentBlob[]
}

export interface FullBackupProjectionOptions {
  temporaryQueuedAttachmentIds?: Iterable<string>
}

const stringValue = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
const ids = (rows: FullBackupRow[]): Set<string> => new Set(rows.map((row) => stringValue(row.id)).filter((id): id is string => Boolean(id)))

/** Rows of temporary chats and everything derived from them, which full backups exclude. */
export interface TemporaryBackupData {
  chatIds: Set<string>
  responseIds: Set<string>
  responseItemIds: Set<string>
  draftIds: Set<string>
  attachmentIds: Set<string>
  attachmentChecksums: Set<string>
  requestLogIds: Set<string>
  workspaceLeaseIds: Set<string>
  agentRunIds: Set<string>
}

/**
 * The columns that identify temporary data. Selecting only these keeps large
 * payloads out of memory while the full rows are streamed.
 */
export const TEMPORARY_BACKUP_KEY_COLUMNS = {
  chats: ['id', 'temporary'],
  responses: ['id', 'chat_id'],
  response_items: ['id', 'response_id'],
  composer_drafts: ['id', 'chat_id', 'state'],
  queued_messages: ['chat_id', 'attachment_ids'],
  attachments: ['id', 'chat_id', 'source_response_id', 'checksum'],
  request_logs: ['id', 'response_id'],
  workspace_leases: ['id', 'chat_id'],
  agent_runs: ['id', 'response_id', 'workspace_lease_id'],
} as const satisfies Partial<Record<FullBackupTable, readonly string[]>>

export type TemporaryBackupKeys = Pick<FullBackupDatabase, keyof typeof TEMPORARY_BACKUP_KEY_COLUMNS>

export function findTemporaryBackupData(database: TemporaryBackupKeys, options: FullBackupProjectionOptions = {}): TemporaryBackupData {
  const temporaryChats = database.chats.filter((row) => row.temporary === true)
  const temporaryChatIds = ids(temporaryChats)
  const temporaryResponses = database.responses.filter((row) => temporaryChatIds.has(String(row.chat_id)))
  const temporaryResponseIds = ids(temporaryResponses)
  const temporaryResponseItems = database.response_items.filter((row) => temporaryResponseIds.has(String(row.response_id)))
  const temporaryResponseItemIds = ids(temporaryResponseItems)
  const temporaryDrafts = database.composer_drafts.filter((row) => temporaryChatIds.has(String(row.chat_id))
    || (row.state as { temporary?: boolean } | null)?.temporary === true)
  const temporaryDraftIds = ids(temporaryDrafts)
  const temporaryQueuedAttachmentIds = new Set(options.temporaryQueuedAttachmentIds ?? [])
  for (const row of database.queued_messages) if (temporaryChatIds.has(String(row.chat_id))) {
    for (const id of row.attachment_ids as string[] ?? []) temporaryQueuedAttachmentIds.add(id)
  }
  for (const row of temporaryDrafts) {
    for (const attachment of (row.state as { attachments?: Array<{ id: string }> } | null)?.attachments ?? []) temporaryQueuedAttachmentIds.add(attachment.id)
  }
  const temporaryAttachments = database.attachments.filter((row) => {
    const attachmentId = stringValue(row.id)
    const chatId = stringValue(row.chat_id)
    const responseId = stringValue(row.source_response_id)
    return Boolean(
      (attachmentId && temporaryQueuedAttachmentIds.has(attachmentId))
      || (chatId && temporaryChatIds.has(chatId))
      || (responseId && temporaryResponseIds.has(responseId)),
    )
  })
  const temporaryRequestLogs = database.request_logs.filter((row) => temporaryResponseIds.has(String(row.response_id)))
  const temporaryWorkspaceLeases = database.workspace_leases.filter((row) => temporaryChatIds.has(String(row.chat_id)))
  const temporaryWorkspaceLeaseIds = ids(temporaryWorkspaceLeases)
  const temporaryAgentRuns = database.agent_runs.filter((row) => {
    const responseId = stringValue(row.response_id)
    const leaseId = stringValue(row.workspace_lease_id)
    return Boolean((responseId && temporaryResponseIds.has(responseId)) || (leaseId && temporaryWorkspaceLeaseIds.has(leaseId)))
  })
  return {
    chatIds: temporaryChatIds,
    responseIds: temporaryResponseIds,
    responseItemIds: temporaryResponseItemIds,
    draftIds: temporaryDraftIds,
    attachmentIds: ids(temporaryAttachments),
    attachmentChecksums: new Set(temporaryAttachments.map((row) => stringValue(row.checksum)).filter((value): value is string => Boolean(value))),
    requestLogIds: ids(temporaryRequestLogs),
    workspaceLeaseIds: temporaryWorkspaceLeaseIds,
    agentRunIds: ids(temporaryAgentRuns),
  }
}

const excludes = (row: FullBackupRow, field: string, excluded: Set<string>): boolean => {
  const value = stringValue(row[field])
  return Boolean(value && excluded.has(value))
}
const withoutReference = (row: FullBackupRow, field: string, excluded: Set<string>): FullBackupRow =>
  excludes(row, field, excluded) ? { ...row, [field]: null } : row

/** Project one row of `table`, or return null when it belongs to temporary data. */
export function projectBackupRow(table: FullBackupTable, row: FullBackupRow, temporary: TemporaryBackupData): FullBackupRow | null {
  const keep = (excluded: boolean) => excluded ? null : row
  switch (FULL_BACKUP_TEMPORARY_DATA_POLICY[table]) {
    case 'preserve': return row
    case 'chat': return keep(temporary.chatIds.has(String(row.id)))
    case 'response': return keep(temporary.responseIds.has(String(row.id)))
    case 'response-reference': return keep(excludes(row, 'response_id', temporary.responseIds))
    case 'response-item': return keep(temporary.responseItemIds.has(String(row.id)))
    case 'response-content-part': return keep(excludes(row, 'response_item_id', temporary.responseItemIds))
    case 'chat-reference': return keep(excludes(row, 'chat_id', temporary.chatIds))
    case 'composer-draft': {
      if (temporary.draftIds.has(String(row.id))) return null
      const state = row.state as { attachments?: Array<{ id: string }> }
      return state?.attachments ? { ...row, state: { ...state, attachments: state.attachments.filter(attachment => !temporary.attachmentIds.has(attachment.id)) } } : row
    }
    case 'composer-draft-attachment': return keep(temporary.draftIds.has(String(row.draft_id)) || temporary.attachmentIds.has(String(row.attachment_id)))
    case 'shelved-draft': return Array.isArray(row.attachment_data)
      ? { ...row, attachment_data: (row.attachment_data as Array<{ id: string }>).filter(attachment => !temporary.attachmentIds.has(attachment.id)) } : row
    case 'shelved-draft-attachment': return keep(excludes(row, 'attachment_id', temporary.attachmentIds))
    case 'queued-message': {
      if (excludes(row, 'chat_id', temporary.chatIds)) return null
      return Array.isArray(row.attachment_ids)
        ? { ...row, attachment_ids: (row.attachment_ids as string[]).filter(id => !temporary.attachmentIds.has(id)) } : row
    }
    case 'attachment': return keep(temporary.attachmentIds.has(String(row.id)))
    case 'redact-source-response': return withoutReference(row, 'source_response_id', temporary.responseIds)
    case 'redact-response': return withoutReference(row, 'response_id', temporary.responseIds)
    case 'chat-turn-embedding': return keep(excludes(row, 'chat_id', temporary.chatIds) || excludes(row, 'response_id', temporary.responseIds))
    case 'request-log': return keep(temporary.requestLogIds.has(String(row.id)))
    case 'generation-attempt': return keep(excludes(row, 'request_log_id', temporary.requestLogIds))
    case 'ocr-attempt': return keep(excludes(row, 'request_log_id', temporary.requestLogIds) || excludes(row, 'attachment_id', temporary.attachmentIds))
    case 'ocr-cache': return keep(temporary.attachmentChecksums.has(String(row.checksum)))
    case 'workspace-lease': return temporary.workspaceLeaseIds.has(String(row.id)) ? null : withoutReference(row, 'response_id', temporary.responseIds)
    case 'agent-run': return keep(temporary.agentRunIds.has(String(row.id)))
    case 'tool-execution': return keep(excludes(row, 'agent_run_id', temporary.agentRunIds) || excludes(row, 'workspace_lease_id', temporary.workspaceLeaseIds))
  }
}

/** The stored blob of a projected attachment row, if it has one. */
export function backupAttachmentBlob(row: FullBackupRow): BackupAttachmentBlob | null {
  const objectKey = stringValue(row.object_key)
  if (row.status !== 'ready' || !objectKey) return null
  return { objectKey, checksum: stringValue(row.checksum) ?? null }
}

export function projectFullBackup(database: FullBackupDatabase, options: FullBackupProjectionOptions = {}): FullBackupProjection {
  const temporary = findTemporaryBackupData(database, options)
  const projected = {} as FullBackupDatabase
  for (const table of FULL_BACKUP_TABLES) {
    projected[table] = database[table].flatMap<FullBackupRow>((row) => projectBackupRow(table, row, temporary) ?? [])
  }
  const attachmentBlobs = projected.attachments.flatMap((row) => backupAttachmentBlob(row) ?? [])
  return { database: projected, attachmentBlobs }
}
