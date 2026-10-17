import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  DEFAULT_TRASH_RETENTION,
  filePurgeAtFor,
  fileTrashRetentionSql,
  trashedChatValues,
  normalChatExpiryCondition,
  parseTrashRetention,
  purgeAtFor,
  trashRetentionValues,
} from './trash.js'

describe('trash retention', () => {
  const deletedAt = new Date('2026-01-01T00:00:00.000Z')

  it('defaults missing and invalid preferences to 30 days', () => {
    expect(parseTrashRetention(undefined)).toBe(DEFAULT_TRASH_RETENTION)
    expect(parseTrashRetention('one-year')).toBe(DEFAULT_TRASH_RETENTION)
  })

  it('accepts every public retention value', () => {
    for (const value of trashRetentionValues) expect(parseTrashRetention(value)).toBe(value)
  })

  it('calculates deadlines from the original deletion time', () => {
    expect(purgeAtFor(deletedAt, 'instant')?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(purgeAtFor(deletedAt, '24h')?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(purgeAtFor(deletedAt, '7d')?.toISOString()).toBe('2026-01-08T00:00:00.000Z')
    expect(purgeAtFor(deletedAt, '30d')?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(purgeAtFor(deletedAt, '90d')?.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(purgeAtFor(deletedAt, 'indefinite')).toBeNull()
  })

  it('keeps Files items at least a day under the same setting', () => {
    expect(filePurgeAtFor(deletedAt, 'instant')?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(filePurgeAtFor(deletedAt, '24h')?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(filePurgeAtFor(deletedAt, '90d')?.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(filePurgeAtFor(deletedAt, 'indefinite')).toBeNull()
  })

  it('keeps Files items trashed before the trash was unified at least 30 days', () => {
    const unifiedSince = new Date('2026-01-05T00:00:00.000Z')
    expect(filePurgeAtFor(deletedAt, 'instant', unifiedSince)?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(filePurgeAtFor(deletedAt, '90d', unifiedSince)?.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(filePurgeAtFor(deletedAt, 'indefinite', unifiedSince)).toBeNull()
    expect(filePurgeAtFor(deletedAt, 'instant', deletedAt)?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
  })

  it('reads Files retention from preferences in SQL, defaulting to 30 days', () => {
    const query = new PgDialect().sqlToQuery(fileTrashRetentionSql(sql`prefs.values`))
    expect(query.sql).toContain("interval '86400000 milliseconds'")
    expect(query.sql).toContain('null::interval')
    expect(query.sql).toMatch(/else interval '2592000000 milliseconds' end\)$/)
    expect(query.params).toEqual([...trashRetentionValues])
  })

  it('keeps expired chats recoverable unless retention is instant', () => {
    expect(trashedChatValues(deletedAt, '7d')).toEqual({
      deletedAt,
      expiresAt: null,
      purgeStartedAt: null,
      updatedAt: deletedAt,
    })
    expect(trashedChatValues(deletedAt, 'instant').purgeStartedAt).toBe(deletedAt)
  })

  it('guards delayed expiry jobs against cancellation and rescheduling', () => {
    const now = new Date('2026-01-08T00:00:00.000Z')
    const expected = new Date('2026-01-07T00:00:00.000Z')
    const query = new PgDialect().sqlToQuery(normalChatExpiryCondition('chat-1', 'user-1', now, expected)!)

    expect(query.sql).toContain('"chats"."expires_at" <= $4')
    expect(query.sql).toContain('"chats"."expires_at" = $5')
    expect(query.sql).toContain('"chats"."deleted_at" is null')
    expect(query.params).toEqual(['chat-1', 'user-1', false, now.toISOString(), expected.toISOString()])
  })
})
