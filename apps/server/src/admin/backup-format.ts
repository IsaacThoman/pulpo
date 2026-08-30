export const FULL_BACKUP_TABLES = [
  'users', 'friendships', 'user_blocks', 'password_credentials', 'user_totp_credentials', 'two_factor_recovery_codes', 'user_preferences', 'audit_events',
  'catalog_icons', 'labs', 'provider_connections',
  'models', 'model_pricing_versions', 'model_presets', 'model_preset_choices', 'folders', 'chats', 'responses',
  'response_items', 'response_content_parts', 'chat_shares', 'attachments', 'user_memory_documents', 'user_memory_document_revisions',
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
  for (const event of database.usage_events ?? []) event.five_hour_cost_micros ??= 0
}
