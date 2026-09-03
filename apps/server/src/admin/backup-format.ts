export const FULL_BACKUP_TABLES = [
  'users', 'friendships', 'user_blocks', 'password_credentials', 'user_totp_credentials', 'two_factor_recovery_codes', 'user_preferences', 'audit_events',
  'catalog_icons', 'labs', 'provider_connections',
  'models', 'model_pricing_versions', 'model_presets', 'model_preset_choices', 'folders', 'chats', 'responses',
  'response_items', 'response_content_parts', 'chat_shares', 'attachments', 'composer_drafts', 'composer_draft_attachments', 'user_memory_documents', 'user_memory_document_revisions',
  'episodic_memory_generations', 'chat_turn_embeddings', 'episodic_memory_metric_buckets',
  'api_keys', 'management_tokens', 'api_key_model_permissions', 'credit_ledger', 'usage_events', 'daily_usage_rollups', 'application_settings',
  'banners', 'request_logs', 'generation_attempts', 'ocr_attempts', 'ocr_cache_entries', 'chat_import_sources',
  'workspace_leases', 'agent_runs', 'tool_executions',
] as const

export type FullBackupTable = typeof FULL_BACKUP_TABLES[number]

/**
 * PostgreSQL generated columns cannot receive explicit values during restore.
 * Listing the durable columns also keeps the lexical tsvector out of archives;
 * PostgreSQL regenerates it from the restored source text.
 */
export const FULL_BACKUP_EXPLICIT_COLUMNS: Partial<Record<FullBackupTable, readonly string[]>> = {
  chat_turn_embeddings: [
    'id', 'generation_id', 'user_id', 'chat_id', 'response_id', 'content_hash', 'chunk_text',
    'embedding', 'status', 'error', 'indexed_at', 'created_at', 'updated_at',
  ],
}

export const OPTIONAL_TABLES_IN_LEGACY_BACKUPS: readonly FullBackupTable[] = [
  'composer_drafts',
  'composer_draft_attachments',
  'user_memory_documents',
  'user_memory_document_revisions',
  'episodic_memory_generations',
  'chat_turn_embeddings',
  'episodic_memory_metric_buckets',
]

/**
 * PostgreSQL's json_populate_recordset uses null for an absent property rather
 * than applying the column default. Keep v1 archives forward-compatible when
 * a later migration adds a required column to an existing backup table.
 */
export function applyFullBackupCompatibilityDefaults(database: Record<string, Array<Record<string, unknown>>>): void {
  for (const user of database.users ?? []) {
    user.profile_color ??= null
    user.avatar_object_key ??= null
    user.avatar_version ??= 0
  }
  for (const provider of database.provider_connections ?? []) provider.tool_result_image_mode ??= 'native'
  for (const response of database.responses ?? []) {
    response.metadata ??= {}
    response.idempotency_scope ??= 'default'
    response.publicly_stored ??= true
  }
  for (const event of database.usage_events ?? []) {
    event.five_hour_cost_micros ??= 0
    event.inference_reference_cost_micros ??= 0
  }
  const loggingRow = (database.application_settings ?? []).find((row) => row.key === 'logging')
  const logging = loggingRow?.value && typeof loggingRow.value === 'object'
    ? loggingRow.value as Record<string, unknown>
    : {}
  const loggingEnabled = logging.logDetailedPayloads === true
  const retention = typeof logging.payloadRetention === 'string' ? logging.payloadRetention : '7d'
  const retentionDurationMs: Record<string, number> = {
    '1h': 3_600_000,
    '24h': 86_400_000,
    '7d': 604_800_000,
    '30d': 2_592_000_000,
    '90d': 7_776_000_000,
  }
  const ocrByRequestLog = new Map<string, Array<Record<string, unknown>>>()
  for (const attempt of database.ocr_attempts ?? []) {
    const requestLogId = typeof attempt.request_log_id === 'string' ? attempt.request_log_id : undefined
    if (!requestLogId) continue
    const attempts = ocrByRequestLog.get(requestLogId) ?? []
    attempts.push(attempt)
    ocrByRequestLog.set(requestLogId, attempts)
  }
  const now = Date.now()
  for (const log of database.request_logs ?? []) {
    const attempts = typeof log.id === 'string' ? ocrByRequestLog.get(log.id) ?? [] : []
    const hasPayload = log.request_payload != null || log.response_payload != null
      || attempts.some((attempt) => attempt.request_payload != null || attempt.response_payload != null)
    let capture = log.capture_detailed_payloads === true
      || (log.capture_detailed_payloads == null && loggingEnabled && hasPayload)
    if (capture && retention !== 'indefinite') {
      const createdAt = new Date(String(log.created_at)).getTime()
      const durationMs = retentionDurationMs[retention] ?? retentionDurationMs['7d']!
      if (Number.isFinite(createdAt)) log.payload_expires_at = new Date(createdAt + durationMs).toISOString()
      const expiresAt = new Date(String(log.payload_expires_at)).getTime()
      if (Number.isFinite(expiresAt) && expiresAt <= now) capture = false
    } else if (capture) log.payload_expires_at = null
    if (!loggingEnabled || !capture) {
      capture = false
      log.request_payload = null
      log.response_payload = null
      for (const attempt of attempts) {
        attempt.request_payload = null
        attempt.response_payload = null
      }
    }
    log.capture_detailed_payloads = capture
  }
}
