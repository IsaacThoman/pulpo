import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRASH_RETENTION,
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
})
