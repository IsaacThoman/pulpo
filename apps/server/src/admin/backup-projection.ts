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
  model_pricing_versions: 'preserve',
  model_presets: 'preserve',
  model_preset_choices: 'preserve',
  chats: 'chat',
  sidebar_shortcuts: 'chat-reference',
  responses: 'response',
  response_items: 'response-item',
  response_content_parts: 'response-content-part',
  chat_shares: 'chat-reference',
  attachments: 'attachment',
  user_memory_documents: 'redact-source-response',
  user_memory_document_revisions: 'redact-source-response',
  file_nodes: 'preserve', file_docs: 'preserve', file_doc_updates: 'preserve', file_folder_layouts: 'preserve', file_agent_changes: 'response-reference',
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
  billing_accounts: 'preserve', billing_subscriptions: 'preserve', billing_checkouts: 'preserve', billing_auto_top_ups: 'preserve', billing_orders: 'preserve', billing_webhook_events: 'preserve',
  weekly_usage_periods: 'preserve', five_hour_usage_periods: 'preserve', shared_allowance_periods: 'preserve', shared_five_hour_usage_periods: 'preserve',
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
const references = (rows: FullBackupRow[], field: string, excluded: Set<string>): FullBackupRow[] => rows.filter((row) => {
  const value = stringValue(row[field])
  return !value || !excluded.has(value)
})
const redactReference = (rows: FullBackupRow[], field: string, excluded: Set<string>): FullBackupRow[] => rows.map((row) => {
  const value = stringValue(row[field])
  return value && excluded.has(value) ? { ...row, [field]: null } : row
})

export function projectFullBackup(database: FullBackupDatabase, options: FullBackupProjectionOptions = {}): FullBackupProjection {
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
  const temporaryAttachmentIds = ids(temporaryAttachments)
  const temporaryAttachmentChecksums = new Set(temporaryAttachments.map((row) => stringValue(row.checksum)).filter((value): value is string => Boolean(value)))
  const temporaryRequestLogs = database.request_logs.filter((row) => temporaryResponseIds.has(String(row.response_id)))
  const temporaryRequestLogIds = ids(temporaryRequestLogs)
  const temporaryWorkspaceLeases = database.workspace_leases.filter((row) => temporaryChatIds.has(String(row.chat_id)))
  const temporaryWorkspaceLeaseIds = ids(temporaryWorkspaceLeases)
  const temporaryAgentRuns = database.agent_runs.filter((row) => {
    const responseId = stringValue(row.response_id)
    const leaseId = stringValue(row.workspace_lease_id)
    return Boolean((responseId && temporaryResponseIds.has(responseId)) || (leaseId && temporaryWorkspaceLeaseIds.has(leaseId)))
  })
  const temporaryAgentRunIds = ids(temporaryAgentRuns)

  const projected = {} as FullBackupDatabase
  for (const table of FULL_BACKUP_TABLES) {
    const rows = database[table]
    switch (FULL_BACKUP_TEMPORARY_DATA_POLICY[table]) {
      case 'preserve': projected[table] = [...rows]; break
      case 'chat': projected[table] = rows.filter((row) => !temporaryChatIds.has(String(row.id))); break
      case 'response': projected[table] = rows.filter((row) => !temporaryResponseIds.has(String(row.id))); break
      case 'response-reference': projected[table] = references(rows, 'response_id', temporaryResponseIds); break
      case 'response-item': projected[table] = rows.filter((row) => !temporaryResponseItemIds.has(String(row.id))); break
      case 'response-content-part': projected[table] = references(rows, 'response_item_id', temporaryResponseItemIds); break
      case 'chat-reference': projected[table] = references(rows, 'chat_id', temporaryChatIds); break
      case 'composer-draft': projected[table] = rows.filter((row) => !temporaryDraftIds.has(String(row.id))).map(row => {
        const state = row.state as { attachments?: Array<{ id: string }> }
        return state?.attachments ? { ...row, state: { ...state, attachments: state.attachments.filter(attachment => !temporaryAttachmentIds.has(attachment.id)) } } : row
      }); break
      case 'composer-draft-attachment': projected[table] = rows.filter((row) => !temporaryDraftIds.has(String(row.draft_id)) && !temporaryAttachmentIds.has(String(row.attachment_id))); break
      case 'shelved-draft': projected[table] = rows.map(row => Array.isArray(row.attachment_data)
        ? { ...row, attachment_data: (row.attachment_data as Array<{ id: string }>).filter(attachment => !temporaryAttachmentIds.has(attachment.id)) } : row); break
      case 'shelved-draft-attachment': projected[table] = references(rows, 'attachment_id', temporaryAttachmentIds); break
      case 'queued-message': projected[table] = references(rows, 'chat_id', temporaryChatIds).map(row => Array.isArray(row.attachment_ids)
        ? { ...row, attachment_ids: (row.attachment_ids as string[]).filter(id => !temporaryAttachmentIds.has(id)) } : row); break
      case 'attachment': projected[table] = rows.filter((row) => !temporaryAttachmentIds.has(String(row.id))); break
      case 'redact-source-response': projected[table] = redactReference(rows, 'source_response_id', temporaryResponseIds); break
      case 'redact-response': projected[table] = redactReference(rows, 'response_id', temporaryResponseIds); break
      case 'chat-turn-embedding': projected[table] = rows.filter((row) => {
        const chatId = stringValue(row.chat_id)
        const responseId = stringValue(row.response_id)
        return !((chatId && temporaryChatIds.has(chatId)) || (responseId && temporaryResponseIds.has(responseId)))
      }); break
      case 'request-log': projected[table] = rows.filter((row) => !temporaryRequestLogIds.has(String(row.id))); break
      case 'generation-attempt': projected[table] = references(rows, 'request_log_id', temporaryRequestLogIds); break
      case 'ocr-attempt': projected[table] = rows.filter((row) => {
        const requestLogId = stringValue(row.request_log_id)
        const attachmentId = stringValue(row.attachment_id)
        return !((requestLogId && temporaryRequestLogIds.has(requestLogId)) || (attachmentId && temporaryAttachmentIds.has(attachmentId)))
      }); break
      case 'ocr-cache': projected[table] = rows.filter((row) => !temporaryAttachmentChecksums.has(String(row.checksum))); break
      case 'workspace-lease': projected[table] = redactReference(
        rows.filter((row) => !temporaryWorkspaceLeaseIds.has(String(row.id))),
        'response_id',
        temporaryResponseIds,
      ); break
      case 'agent-run': projected[table] = rows.filter((row) => !temporaryAgentRunIds.has(String(row.id))); break
      case 'tool-execution': projected[table] = rows.filter((row) => {
        const agentRunId = stringValue(row.agent_run_id)
        const leaseId = stringValue(row.workspace_lease_id)
        return !((agentRunId && temporaryAgentRunIds.has(agentRunId)) || (leaseId && temporaryWorkspaceLeaseIds.has(leaseId)))
      }); break
    }
  }

  const attachmentBlobs = projected.attachments.flatMap((row) => {
    const objectKey = stringValue(row.object_key)
    if (row.status !== 'ready' || !objectKey) return []
    return [{ objectKey, checksum: stringValue(row.checksum) ?? null }]
  })
  return { database: projected, attachmentBlobs }
}
