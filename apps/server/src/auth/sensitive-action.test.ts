import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credential: { passwordHash: 'hash' } as { passwordHash: string } | undefined,
  verifyPassword: vi.fn(),
  hasTwoFactor: vi.fn(),
  verifySecondFactor: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.credential ? [mocks.credential] : []) })),
      })),
    })),
  },
}))
vi.mock('./service.js', () => ({ verifyPassword: mocks.verifyPassword }))
vi.mock('./two-factor.js', () => ({
  hasTwoFactor: mocks.hasTwoFactor,
  verifySecondFactor: mocks.verifySecondFactor,
}))

import { requireSecretRevealAuth, requireSensitiveAuth } from './sensitive-action.js'

describe('sensitive action authentication', () => {
  beforeEach(() => {
    mocks.credential = { passwordHash: 'hash' }
    mocks.verifyPassword.mockReset().mockResolvedValue(true)
    mocks.hasTwoFactor.mockReset().mockResolvedValue(false)
    mocks.verifySecondFactor.mockReset().mockResolvedValue(undefined)
  })

  it('requires the current password', async () => {
    mocks.verifyPassword.mockResolvedValue(false)
    await expect(requireSensitiveAuth('user-id', 'wrong')).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.hasTwoFactor).not.toHaveBeenCalled()
  })

  it('rejects accounts without a password credential', async () => {
    mocks.credential = undefined
    await expect(requireSensitiveAuth('user-id', 'password')).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })

  it('allows a valid password when two-factor authentication is disabled', async () => {
    await expect(requireSensitiveAuth('user-id', 'password')).resolves.toBeUndefined()
    expect(mocks.verifySecondFactor).not.toHaveBeenCalled()
  })

  it('requires and verifies a second factor when enabled', async () => {
    mocks.hasTwoFactor.mockResolvedValue(true)
    await expect(requireSensitiveAuth('user-id', 'password')).rejects.toMatchObject({ code: 'two_factor_code_required' })
    await expect(requireSensitiveAuth('user-id', 'password', '123456')).resolves.toBeUndefined()
    expect(mocks.verifySecondFactor).toHaveBeenCalledWith('user-id', '123456')
  })
})

describe('secret reveal authentication', () => {
  beforeEach(() => {
    mocks.credential = { passwordHash: 'hash' }
    mocks.verifyPassword.mockReset().mockResolvedValue(true)
    mocks.hasTwoFactor.mockReset().mockResolvedValue(false)
    mocks.verifySecondFactor.mockReset().mockResolvedValue(undefined)
  })

  it('uses only a second factor when two-factor authentication is enabled', async () => {
    mocks.hasTwoFactor.mockResolvedValue(true)
    await expect(requireSecretRevealAuth('user-id', undefined, '123456')).resolves.toBeUndefined()
    expect(mocks.verifySecondFactor).toHaveBeenCalledWith('user-id', '123456')
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })

  it('requires a second factor instead of a password when enabled', async () => {
    mocks.hasTwoFactor.mockResolvedValue(true)
    await expect(requireSecretRevealAuth('user-id', 'password')).rejects.toMatchObject({ code: 'two_factor_code_required' })
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })

  it('falls back to the current password when two-factor authentication is disabled', async () => {
    await expect(requireSecretRevealAuth('user-id', 'password')).resolves.toBeUndefined()
    expect(mocks.verifyPassword).toHaveBeenCalledWith('hash', 'password')
    expect(mocks.verifySecondFactor).not.toHaveBeenCalled()
  })

  it('requires the current password when two-factor authentication is disabled', async () => {
    await expect(requireSecretRevealAuth('user-id')).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })
})
