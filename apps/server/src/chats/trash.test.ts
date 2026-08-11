import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  DEFAULT_TRASH_RETENTION,
  expiredChatTrashValues,
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

  it('keeps expired chats recoverable unless retention is instant', () => {
    expect(expiredChatTrashValues(deletedAt, '7d')).toEqual({
      deletedAt,
      expiresAt: null,
      purgeStartedAt: null,
      updatedAt: deletedAt,
    })
    expect(expiredChatTrashValues(deletedAt, 'instant').purgeStartedAt).toBe(deletedAt)
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
