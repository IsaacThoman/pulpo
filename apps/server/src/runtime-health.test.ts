import { describe, expect, it, vi } from 'vitest'
import { checkReadiness } from './runtime-health.js'

describe('deployment readiness', () => {
  it('requires every dependency to succeed', async () => {
    const database = vi.fn().mockResolvedValue([])
    const redis = vi.fn().mockResolvedValue('PONG')
    await expect(checkReadiness([database, redis])).resolves.toBeUndefined()
    expect(database).toHaveBeenCalledOnce()
    expect(redis).toHaveBeenCalledOnce()
    await expect(checkReadiness([database, async () => { throw new Error('Redis unavailable') }])).rejects.toThrow('Redis unavailable')
  })

  it('fails a hung dependency within the readiness deadline', async () => {
    await expect(checkReadiness([() => new Promise(() => {})], 10)).rejects.toThrow('Readiness check timed out')
  })
})
