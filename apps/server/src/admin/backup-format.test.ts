import { describe, expect, it } from 'vitest'
import {
  applyFullBackupCompatibilityDefaults,
  FULL_BACKUP_EXPLICIT_COLUMNS,
  FULL_BACKUP_TABLES,
  OPTIONAL_TABLES_IN_LEGACY_BACKUPS,
} from './backup-format.js'

describe('full backup format', () => {
  it('includes memory documents and episodic chat vectors in dependency order', () => {
    const documents = FULL_BACKUP_TABLES.indexOf('user_memory_documents')
    const revisions = FULL_BACKUP_TABLES.indexOf('user_memory_document_revisions')
    const generation = FULL_BACKUP_TABLES.indexOf('episodic_memory_generations')
    const chatVectors = FULL_BACKUP_TABLES.indexOf('chat_turn_embeddings')
    const metrics = FULL_BACKUP_TABLES.indexOf('episodic_memory_metric_buckets')
    expect(revisions).toBeGreaterThan(documents)
    expect(chatVectors).toBeGreaterThan(generation)
    expect(metrics).toBeGreaterThan(chatVectors)
    expect(FULL_BACKUP_TABLES).not.toEqual(expect.arrayContaining(['memories', 'saved_memory_embeddings']))
  })

  it('restores vector tables without writing generated lexical columns', () => {
    expect(FULL_BACKUP_EXPLICIT_COLUMNS.chat_turn_embeddings).not.toContain('search_vector')
  })

  it('accepts full backups created before episodic memory was introduced', () => {
    expect(OPTIONAL_TABLES_IN_LEGACY_BACKUPS).toEqual([
      'user_memory_documents',
      'user_memory_document_revisions',
      'episodic_memory_generations',
      'chat_turn_embeddings',
      'episodic_memory_metric_buckets',
    ])
  })

  it('supplies required columns added after older v1 archives were created', () => {
    const database = {
      users: [{}],
      provider_connections: [{}],
      responses: [{}],
      usage_events: [{}],
    }

    applyFullBackupCompatibilityDefaults(database)

    expect(database.users[0]).toMatchObject({ profile_color: null, avatar_object_key: null, avatar_version: 0 })
    expect(database.provider_connections[0]).toMatchObject({ tool_result_image_mode: 'native' })
    expect(database.responses[0]).toMatchObject({ metadata: {}, idempotency_scope: 'default', publicly_stored: true })
    expect(database.usage_events[0]).toMatchObject({ five_hour_cost_micros: 0 })
  })

  it('preserves values already stored in a newer backup', () => {
    const database = {
      users: [{ avatar_version: 7 }],
      provider_connections: [{ tool_result_image_mode: 'separate' }],
      responses: [{ metadata: { source: 'api' }, idempotency_scope: 'api:key', publicly_stored: false }],
      usage_events: [{ five_hour_cost_micros: 42 }],
    }

    applyFullBackupCompatibilityDefaults(database)

    expect(database.users[0]!.avatar_version).toBe(7)
    expect(database.provider_connections[0]!.tool_result_image_mode).toBe('separate')
    expect(database.responses[0]).toEqual({ metadata: { source: 'api' }, idempotency_scope: 'api:key', publicly_stored: false })
    expect(database.usage_events[0]!.five_hour_cost_micros).toBe(42)
  })
})
