import { describe, expect, it } from 'vitest'
import {
  FULL_BACKUP_EXPLICIT_COLUMNS,
  FULL_BACKUP_TABLES,
  OPTIONAL_TABLES_IN_LEGACY_BACKUPS,
} from './backup-format.js'

describe('full backup format', () => {
  it('includes episodic-memory generations and both vector stores in dependency order', () => {
    const generation = FULL_BACKUP_TABLES.indexOf('episodic_memory_generations')
    const chatVectors = FULL_BACKUP_TABLES.indexOf('chat_turn_embeddings')
    const factVectors = FULL_BACKUP_TABLES.indexOf('saved_memory_embeddings')
    expect(generation).toBeGreaterThan(FULL_BACKUP_TABLES.indexOf('memories'))
    expect(chatVectors).toBeGreaterThan(generation)
    expect(factVectors).toBeGreaterThan(generation)
  })

  it('restores vector tables without writing generated lexical columns', () => {
    expect(FULL_BACKUP_EXPLICIT_COLUMNS.chat_turn_embeddings).not.toContain('search_vector')
    expect(FULL_BACKUP_EXPLICIT_COLUMNS.saved_memory_embeddings).not.toContain('search_vector')
  })

  it('accepts full backups created before episodic memory was introduced', () => {
    expect(OPTIONAL_TABLES_IN_LEGACY_BACKUPS).toEqual([
      'episodic_memory_generations',
      'chat_turn_embeddings',
      'saved_memory_embeddings',
    ])
  })
})
