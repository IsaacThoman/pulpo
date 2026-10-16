import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SIGNED_IN_ACCOUNTS } from '@pulpo/contracts'
import { configureDesktopRuntime } from './runtime'
import { activateSignedInAccount, listSignedInAccounts, prepareToAddAccount, signOutSignedInAccount } from './signed-in-accounts'

const INSTANCE = 'https://one.example'
const token = (character: string) => character.repeat(43)
const expiresAt = '2099-01-01T00:00:00.000Z'
const person = (id: string) => ({ id, name: `User ${id}`, username: `user_${id}`, email: `${id}@example.test`, avatarUrl: `/api/users/${id}/avatar`, profileColor: null })

let session: { instanceUrl: string; token: string; expiresAt: string } | null
let others: { instanceUrl: string; accounts: Array<{ userId: string; token: string; expiresAt: string }> } | null
let validTokens: Map<string, ReturnType<typeof person>>
let revoked: string[]

beforeEach(() => {
  session = { instanceUrl: INSTANCE, token: token('a'), expiresAt }
  others = null
  validTokens = new Map()
  revoked = []
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://desktop.pulpo.invalid' },
      pulpoDesktop: {
        platform: 'desktop',
        session: {
          load: async () => session,
          store: async (next: typeof session) => { session = next },
          clear: async () => { session = null },
        },
        accounts: {
          load: async () => others,
          store: async (next: typeof others) => { others = next },
        },
      },
    },
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const bearer = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? ''
    if (url.endsWith('/api/mobile/auth/logout')) {
      revoked.push(bearer)
      return new Response(null, { status: 204 })
    }
    const user = validTokens.get(bearer)
    return user
      ? Response.json({ user })
      : Response.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, { status: 401 })
  }))
  configureDesktopRuntime({ instanceUrl: INSTANCE, token: token('a') })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('desktop signed-in accounts', () => {
  it('lists the active account first and prunes revoked and duplicate sessions', async () => {
    validTokens.set(token('w'), person('work'))
    others = { instanceUrl: INSTANCE, accounts: [
      { userId: 'work', token: token('w'), expiresAt },
      { userId: 'gone', token: token('g'), expiresAt },
      { userId: 'me', token: token('d'), expiresAt },
    ] }

    const accounts = await listSignedInAccounts(person('me'))

    expect(accounts.map((account) => [account.id, account.active, account.avatarUrl])).toEqual([
      ['me', true, '/api/users/me/avatar'],
      ['work', false, '/api/users/work/avatar'],
    ])
    expect(others?.accounts.map((account) => account.userId)).toEqual(['work'])
    await vi.waitFor(() => expect(revoked).toEqual([token('d')]))
  })

  it('ignores accounts stored for another instance', async () => {
    others = { instanceUrl: 'https://two.example', accounts: [{ userId: 'work', token: token('w'), expiresAt }] }
    expect(await listSignedInAccounts(person('me'))).toEqual([expect.objectContaining({ id: 'me', active: true })])
  })

  it('keeps the active session when adding an account, up to the limit', async () => {
    await prepareToAddAccount(person('me'))
    expect(session).toBeNull()
    expect(others?.accounts).toEqual([{ userId: 'me', token: token('a'), expiresAt }])

    session = { instanceUrl: INSTANCE, token: token('n'), expiresAt }
    others = { instanceUrl: INSTANCE, accounts: Array.from({ length: MAX_SIGNED_IN_ACCOUNTS - 1 }, (_, index) => ({ userId: `u${index}`, token: token(String(index)), expiresAt })) }
    await expect(prepareToAddAccount(person('new'))).rejects.toMatchObject({ code: 'account_limit' })
    expect(session?.token).toBe(token('n'))
  })

  it('swaps the active session with a signed-in account', async () => {
    validTokens.set(token('w'), person('work'))
    others = { instanceUrl: INSTANCE, accounts: [{ userId: 'work', token: token('w'), expiresAt }] }

    const user = await activateSignedInAccount('work', person('me'))

    expect(user.id).toBe('work')
    expect(session).toEqual({ instanceUrl: INSTANCE, token: token('w'), expiresAt })
    expect(others?.accounts).toEqual([{ userId: 'me', token: token('a'), expiresAt }])
  })

  it('drops an account whose session expired instead of activating it', async () => {
    others = { instanceUrl: INSTANCE, accounts: [{ userId: 'work', token: token('w'), expiresAt }] }

    await expect(activateSignedInAccount('work', person('me'))).rejects.toMatchObject({ code: 'account_signed_out' })
    expect(session?.token).toBe(token('a'))
    expect(others?.accounts).toEqual([])
  })

  it('revokes an inactive account when signing it out', async () => {
    others = { instanceUrl: INSTANCE, accounts: [{ userId: 'work', token: token('w'), expiresAt }] }
    await signOutSignedInAccount('work')
    expect(others?.accounts).toEqual([])
    await vi.waitFor(() => expect(revoked).toEqual([token('w')]))
  })
})
