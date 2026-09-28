import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createChatSchema, updateChatSchema } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({ rows: [] as { id: string }[], where: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: {
  select: () => ({ from: () => ({ where: async (condition: unknown) => {
    mocks.where(condition)
    return mocks.rows
  } }) }),
} }))
import { assertFileScope } from './file-scope.js'

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'

beforeEach(() => { mocks.rows = []; vi.clearAllMocks() })

describe('chat Files scope', () => {
  it('normalizes the scope: the root replaces folders, and repeats collapse', () => {
    expect(createChatSchema.parse({ modelId: 'm' }).fileScopeIds).toEqual([])
    expect(createChatSchema.parse({ modelId: 'm', fileScopeIds: [a, 'root'] }).fileScopeIds).toEqual(['root'])
    expect(updateChatSchema.parse({ fileScopeIds: [a, a.toUpperCase(), b] }).fileScopeIds).toEqual([a, b])
    expect(() => updateChatSchema.parse({ fileScopeIds: ['elsewhere'] })).toThrow()
  })

  it('needs no lookup for an empty or whole-tree scope', async () => {
    await assertFileScope('owner', [])
    await assertFileScope('owner', ['root'])
    expect(mocks.where).not.toHaveBeenCalled()
  })

  it('accepts only live folders the user owns', async () => {
    mocks.rows = [{ id: a }, { id: b }]
    await assertFileScope('owner', [a, b])
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0])
    expect(query.params).toEqual(expect.arrayContaining([a, b, 'owner', 'folder']))
    expect(query.sql).toContain('"file_nodes"."trashed_at" is null')
  })

  it('rejects a scope with any folder that is missing, trashed, foreign, or not a folder', async () => {
    mocks.rows = [{ id: a }]
    await expect(assertFileScope('owner', [a, b])).rejects.toMatchObject({ statusCode: 400, code: 'invalid_file_scope' })
  })
})
