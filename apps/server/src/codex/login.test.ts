import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  attempt: {
    id: '00000000-0000-7000-8000-000000000001',
    userId: '00000000-0000-7000-8000-000000000002',
    status: 'queued',
    expiresAt: null as Date | null,
  },
  statusWrites: [] as string[],
}))

function lazyUpdate(values: Record<string, unknown>) {
  let result: Promise<Array<{ id: string }>> | undefined
  const execute = () => {
    result ??= Promise.resolve().then(() => {
      if (typeof values.status === 'string' && values.status !== 'connected') {
        state.attempt.status = values.status
        if (values.expiresAt instanceof Date) state.attempt.expiresAt = values.expiresAt
        state.statusWrites.push(values.status)
      }
      return [{ id: state.attempt.id }]
    })
    return result
  }
  return {
    returning: () => ({
      then: <TResult1 = Array<{ id: string }>, TResult2 = never>(
        onfulfilled?: ((value: Array<{ id: string }>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => execute().then(onfulfilled, onrejected),
    }),
    then: <TResult1 = Array<{ id: string }>, TResult2 = never>(
      onfulfilled?: ((value: Array<{ id: string }>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => execute().then(onfulfilled, onrejected),
  }
}

vi.mock('../database/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ ...state.attempt }] }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({ where: () => lazyUpdate(values) }),
    }),
  },
}))

vi.mock('./credential-store.js', () => ({
  codexPlanType: () => 'plus',
  isSupportedCodexPlan: () => true,
  UserCredentialStore: class {},
  createCodexModels: () => ({
    login: async (_providerId: string, _type: string, interaction: {
      prompt: (prompt: unknown) => Promise<string>
      notify: (event: unknown) => void
    }) => {
      await interaction.prompt({
        type: 'select',
        options: [{ id: 'browser' }, { id: 'device_code' }],
      })
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.openai.com/codex/device',
        intervalSeconds: 5,
        expiresInSeconds: 900,
      })
      return { type: 'oauth', access: 'redacted', refresh: 'redacted', expires: Date.now() + 60_000 }
    },
  }),
}))

import { processCodexLogin } from './login.js'

describe('processCodexLogin', () => {
  beforeEach(() => {
    state.attempt.status = 'queued'
    state.attempt.expiresAt = null
    state.statusWrites = []
  })

  it('executes the lazy device-code update before completing the login attempt', async () => {
    await processCodexLogin({ attemptId: state.attempt.id })

    expect(state.statusWrites).toEqual(['waiting', 'completed'])
    expect(state.attempt.expiresAt).toBeInstanceOf(Date)
  })
})
