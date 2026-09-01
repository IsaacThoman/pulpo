import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getValue, randomUUID, setValue } = vi.hoisted(() => ({
  getValue: vi.fn(),
  randomUUID: vi.fn(),
  setValue: vi.fn(),
}))

vi.mock('expo-crypto', () => ({ randomUUID }))
vi.mock('../data/database', () => ({ getValue, setValue }))

import { realtimeClientId } from './realtimeClientId'

describe('realtimeClientId', () => {
  beforeEach(() => {
    getValue.mockReset()
    randomUUID.mockReset()
    setValue.mockReset()
  })

  it('reuses the persisted client identity', async () => {
    getValue.mockResolvedValue('ios-existing')

    await expect(realtimeClientId('account-one')).resolves.toBe('ios-existing')
    expect(randomUUID).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
  })

  it('persists a new client identity for later mounts', async () => {
    getValue.mockResolvedValue(null)
    randomUUID.mockReturnValue('generated-id')

    await expect(realtimeClientId('account-one')).resolves.toBe('ios-generated-id')
    expect(setValue).toHaveBeenCalledWith('account-one', 'realtime-client-id', 'ios-generated-id')
  })
})
