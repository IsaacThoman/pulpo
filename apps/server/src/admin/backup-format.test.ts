import { describe, expect, it } from 'vitest'
import {
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
})
