import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'

const state = vi.hoisted(() => ({
  setting: undefined as unknown,
  attempt: undefined as Record<string, unknown> | undefined,
  response: undefined as Record<string, unknown> | undefined,
  credential: { encryptedCredential: 'existing-credential' } as Record<string, unknown>,
  locks: 0,
  writes: [] as string[],
}))

vi.mock('../database/client.js', () => {
  const db = {
    execute: vi.fn(async () => { state.locks += 1 }),
    select: vi.fn(() => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table)
      const query = {
        where: () => query,
        for: () => query,
        limit: async () => name === 'application_settings'
          ? state.setting === undefined ? [] : [{ value: state.setting }]
          : name === 'responses' ? state.response ? [state.response] : []
          : state.attempt ? [state.attempt] : [],
      }
      return query
    } })),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => ({ where: async () => {
      const name = getTableName(table)
      state.writes.push(name)
      if (name === 'responses') Object.assign(state.response!, value)
      if (name === 'codex_login_attempts') Object.assign(state.attempt!, value)
    } }) }),
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (value: Record<string, unknown>) => ({
      onConflictDoUpdate: async () => {
        state.writes.push(getTableName(table))
        state.credential = value
      },
    }) }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  }
  return { db }
})
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'test' }) }))
vi.mock('../lib/crypto.js', () => ({ encryptSecret: () => 'new-encrypted-credential', decryptSecret: vi.fn() }))

import { codexSettingsSchema, parseCodexSettings } from '../settings/application-settings.js'
import { codexEnabled, requireCodexEnabled } from './policy.js'
import { startCodexGeneration } from './generation-policy.js'
import { completeCodexLogin, processCodexLogin } from './login.js'

const credential = { type: 'oauth' as const, access: 'access', refresh: 'refresh', expires: Date.now() + 60_000 }

describe('instance Codex policy', () => {
  beforeEach(() => {
    state.setting = undefined
    state.response = { id: 'response', status: 'queued' }
    state.attempt = { id: 'attempt', userId: 'user', status: 'waiting', expiresAt: new Date(Date.now() + 60_000) }
    state.credential = { encryptedCredential: 'existing-credential' }
    state.writes = []
    state.locks = 0
  })

  it.each([undefined, null, {}, { enabled: 'true' }, { enabled: false }])('defaults off for missing, invalid or disabled settings: %j', async (setting) => {
    state.setting = setting
    expect(parseCodexSettings(setting)).toEqual({ enabled: false })
    expect(await codexEnabled()).toBe(false)
    await expect(requireCodexEnabled()).rejects.toMatchObject({ statusCode: 403, code: 'codex_disabled' })
  })

  it('validates writes and permits explicitly enabled instances', async () => {
    expect(() => codexSettingsSchema.parse({ enabled: 'true' })).toThrow()
    state.setting = { enabled: true }
    await expect(requireCodexEnabled()).resolves.toBeUndefined()
  })

  it('blocks queued work without claiming or modifying the response', async () => {
    expect(await startCodexGeneration('response')).toBe(false)
    expect(state.response?.status).toBe('queued')
    expect(state.writes).toEqual([])
    expect(state.locks).toBe(1)
  })

  it('claims enabled queued work and lets that response continue after disabling', async () => {
    state.setting = { enabled: true }
    expect(await startCodexGeneration('response')).toBe(true)
    expect(state.response).toMatchObject({ status: 'in_progress', startedAt: expect.any(Date) })
    state.setting = { enabled: false }
    expect(await startCodexGeneration('response')).toBe(true)
    expect(state.writes).toEqual(['responses'])
  })

  it.each(['completed', 'failed', 'cancelled'])('does not restart %s responses', async (status) => {
    state.setting = { enabled: true }
    state.response!.status = status
    expect(await startCodexGeneration('response')).toBeNull()
    expect(state.writes).toEqual([])
  })

  it('cancels a queued login without starting OAuth when disabled', async () => {
    await processCodexLogin({ attemptId: 'attempt' })
    expect(state.attempt?.status).toBe('cancelled')
    expect(state.credential.encryptedCredential).toBe('existing-credential')
  })

  it('rejects a late OAuth completion without overwriting retained credentials', async () => {
    await completeCodexLogin('attempt', credential)
    expect(state.attempt?.status).toBe('cancelled')
    expect(state.credential.encryptedCredential).toBe('existing-credential')
    expect(state.writes).not.toContain('user_provider_credentials')
    expect(state.locks).toBe(1)
  })

  it('does not revive cancelled logins after re-enabling', async () => {
    state.setting = { enabled: true }
    state.attempt!.status = 'cancelled'
    await completeCodexLogin('attempt', credential)
    expect(state.writes).toEqual([])
  })

  it('persists a permitted completion and marks the attempt complete together', async () => {
    state.setting = { enabled: true }
    await completeCodexLogin('attempt', credential)
    expect(state.credential).toMatchObject({ encryptedCredential: 'new-encrypted-credential', status: 'connected' })
    expect(state.attempt?.status).toBe('completed')
    expect(state.writes).toEqual(['user_provider_credentials', 'codex_login_attempts'])
    expect(state.locks).toBe(2)
  })

  it('preserves the old connection when a new login expires', async () => {
    state.setting = { enabled: true }
    state.attempt!.expiresAt = new Date(0)
    await completeCodexLogin('attempt', credential)
    expect(state.attempt?.status).toBe('expired')
    expect(state.credential.encryptedCredential).toBe('existing-credential')
  })
})
