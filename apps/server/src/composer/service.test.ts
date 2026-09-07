import { describe, expect, it, vi } from 'vitest'
import { emptyComposerState, type ComposerWrite } from '@pulpo/contracts'
import type { db } from '../database/client.js'
import { accessComposer } from './service.js'

function fixture(temporary = false, legacy = false) {
  let row = { id: 'draft', draftId: 'new', revision: 2, clearedRevision: 0, mutationId: null,
    state: { ...emptyComposerState(), content: 'normal draft', temporary: legacy }, expiresAt: null }
  const queries: unknown[][] = []
  const insert = vi.fn(() => ({ values: () => ({ onConflictDoNothing: async () => {} }) }))
  const update = vi.fn(() => ({ set: (patch: object) => ({ where: () => ({ returning: async () => {
    row = { ...row, ...patch }
    return [row]
  } }) }) }))
  const remove = vi.fn(() => ({ where: async () => {} }))
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => queries.shift() ?? [row] }) }) }),
    insert, update, delete: remove,
  }
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx))
  const database = { transaction } as unknown as Pick<typeof db, 'transaction'>
  return { database, transaction, insert, update, remove, row: () => row,
    chat: () => queries.push([{ temporary, expiresAt: null }]),
  }
}
const write: ComposerWrite = { draftId: 'new', baseRevision: 2, mutationId: 'client:1', patch: { content: 'new draft' } }

describe('temporary composer service restrictions', () => {
  it('rejects the entire write when an older client publishes temporary mode', async () => {
    const f = fixture()
    expect(await accessComposer('owner', 'new', { ...write, patch: { temporary: true, content: 'secret' } }, f.database))
      .toEqual({ ok: false, error: 'temporary_composer_disabled' })
    expect(f.transaction).not.toHaveBeenCalled()
  })

  it.each([false, true])('rejects temporary-chat draft access (writing: %s) before creating a draft', async (writing) => {
    const f = fixture(true)
    f.chat()
    expect(await accessComposer('owner', 'temporary-chat', writing ? { ...write, draftId: 'temporary-chat' } : undefined, f.database))
      .toEqual({ ok: false, error: 'temporary_composer_disabled' })
    expect(f.insert).not.toHaveBeenCalled()
    expect(f.update).not.toHaveBeenCalled()
  })

  it('clears a legacy temporary new-chat draft before returning or broadcasting it', async () => {
    const f = fixture(false, true)
    expect(await accessComposer('owner', 'new', undefined, f.database)).toMatchObject({ ok: true,
      snapshot: { revision: 3, clearedRevision: 3, mutationId: null, state: emptyComposerState() },
    })
    expect(f.remove).toHaveBeenCalledOnce()
    expect(f.row().state.content).toBe('')
  })

  it('preserves normal draft writes and keeps temporary mode false', async () => {
    const f = fixture()
    expect(await accessComposer('owner', 'new', { ...write, patch: { ...write.patch, temporary: false } }, f.database))
      .toMatchObject({ ok: true, snapshot: { state: { content: 'new draft', temporary: false }, revision: 3 } })
  })
})
