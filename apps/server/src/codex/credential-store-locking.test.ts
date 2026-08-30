import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '@earendil-works/pi-ai'

const state = vi.hoisted(() => ({
  encryptedCredential: undefined as string | undefined,
  transactionTail: Promise.resolve() as Promise<unknown>,
  locks: [] as string[],
}))

function resultRows() {
  const rows = state.encryptedCredential
    ? [{ providerId: 'openai-codex', encryptedCredential: state.encryptedCredential }]
    : []
  return {
    limit: async () => rows,
    then: <TResult1 = typeof rows, TResult2 = never>(
      onfulfilled?: ((value: typeof rows) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  }
}

function createTransactionDatabase() {
  return {
    execute: async (statement: unknown) => { state.locks.push(String(statement)) },
    select: () => ({ from: () => ({ where: () => resultRows() }) }),
    insert: () => ({ values: (values: { encryptedCredential: string }) => ({
      onConflictDoUpdate: async ({ set }: { set: { encryptedCredential: string } }) => {
        state.encryptedCredential = state.encryptedCredential ? set.encryptedCredential : values.encryptedCredential
      },
    }) }),
    delete: () => ({ where: async () => { state.encryptedCredential = undefined } }),
  }
}

vi.mock('../database/client.js', () => {
  const transactionDatabase = createTransactionDatabase()
  return { db: {
    select: transactionDatabase.select,
    transaction: <T>(task: (database: ReturnType<typeof createTransactionDatabase>) => Promise<T>) => {
      const result = state.transactionTail.then(() => task(transactionDatabase))
      state.transactionTail = result.catch(() => undefined)
      return result
    },
  } }
})
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'test-encryption-key-that-is-long-enough' }) }))

import { UserCredentialStore } from './credential-store.js'

const first: Credential = { type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: 1 }
const second: Credential = { type: 'oauth', access: 'access-2', refresh: 'refresh-2', expires: 2 }

describe('UserCredentialStore', () => {
  beforeEach(() => {
    state.encryptedCredential = undefined
    state.transactionTail = Promise.resolve()
    state.locks = []
  })

  it('encrypts credential CRUD and never stores plaintext tokens', async () => {
    const store = new UserCredentialStore('user-1')
    await store.modify('openai-codex', async () => first)
    expect(state.encryptedCredential).toMatch(/^v1\./)
    expect(state.encryptedCredential).not.toContain('access-1')
    expect(await store.read('openai-codex')).toEqual(first)
    expect(await store.list()).toEqual([{ providerId: 'openai-codex', type: 'oauth' }])
    await store.delete('openai-codex')
    expect(await store.read('openai-codex')).toBeUndefined()
  })

  it('serializes concurrent refresh-token rotation through the transaction lock', async () => {
    const store = new UserCredentialStore('user-1')
    await store.modify('openai-codex', async () => first)
    const observed: Array<Credential | undefined> = []
    await Promise.all([
      store.modify('openai-codex', async (current) => {
        observed.push(current)
        await new Promise((resolve) => setTimeout(resolve, 5))
        return second
      }),
      store.modify('openai-codex', async (current) => {
        observed.push(current)
        return undefined
      }),
    ])
    expect(observed).toEqual([first, second])
    expect(await store.read('openai-codex')).toEqual(second)
    expect(state.locks.length).toBeGreaterThanOrEqual(3)
  })

  it('does not let a cancelled stale login delete a newer credential', async () => {
    const store = new UserCredentialStore('user-1')
    await store.modify('openai-codex', async () => second)
    await store.deleteIfMatches('openai-codex', first)
    expect(await store.read('openai-codex')).toEqual(second)
    await store.deleteIfMatches('openai-codex', second)
    expect(await store.read('openai-codex')).toBeUndefined()
  })
})
