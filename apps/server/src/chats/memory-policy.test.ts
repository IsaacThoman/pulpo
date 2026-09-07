import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const mocks = vi.hoisted(() => ({ rows: [] as { temporary: boolean }[], where: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: {
  select: () => ({ from: () => ({ where: (condition: unknown) => {
    mocks.where(condition)
    return { limit: async () => mocks.rows }
  } }) }),
} }))
import { chatAllowsMemory, chatCanAccessMemory } from './memory-policy.js'

beforeEach(() => { mocks.rows = []; vi.clearAllMocks() })
describe('chat memory policy', () => {
  it('fails closed unless chat state explicitly permits memory', () => {
    expect(chatAllowsMemory({ temporary: true })).toBe(false)
    expect(chatAllowsMemory(undefined)).toBe(false)
    expect(chatAllowsMemory(null)).toBe(false)
    expect(chatAllowsMemory({ temporary: false })).toBe(true)
  })
  it('checks caller ownership and availability before allowing memory', async () => {
    mocks.rows = [{ temporary: false }]
    expect(await chatCanAccessMemory('owner', 'current')).toBe(true)
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0])
    expect(query.params).toContain('owner')
    expect(query.params).toContain('current')
    expect(query.sql).toContain('"chats"."user_id"')
    expect(query.sql).toContain('"chats"."deleted_at" is null')
    expect(query.sql).toContain('"chats"."purge_started_at" is null')
    expect(query.sql).toContain('"chats"."expires_at"')
  })
  it.each([undefined, true])('rejects missing and temporary caller chats: %s', async (temporary) => {
    mocks.rows = temporary === undefined ? [] : [{ temporary }]
    expect(await chatCanAccessMemory('owner', 'current')).toBe(false)
  })
})
