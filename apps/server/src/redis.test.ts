import { describe, expect, it, vi } from 'vitest'
import { deleteRedisKeysByPattern } from './redis-keys.js'

describe('Redis key cleanup', () => {
  it('deletes matching application keys across every scan page', async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce(['17', ['pulpo:first', 'pulpo:second']])
      .mockResolvedValueOnce(['0', ['pulpo:third']])
    const unlink = vi.fn(async (...keys: string[]) => keys.length)

    await deleteRedisKeysByPattern({ scan, unlink }, 'pulpo:*')

    expect(scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'pulpo:*', 'COUNT', 1_000)
    expect(scan).toHaveBeenNthCalledWith(2, '17', 'MATCH', 'pulpo:*', 'COUNT', 1_000)
    expect(unlink).toHaveBeenNthCalledWith(1, 'pulpo:first', 'pulpo:second')
    expect(unlink).toHaveBeenNthCalledWith(2, 'pulpo:third')
  })

  it('does not issue an empty unlink command', async () => {
    const scan = vi.fn(async () => ['0', []] as [string, string[]])
    const unlink = vi.fn(async () => 0)

    await deleteRedisKeysByPattern({ scan, unlink }, 'pulpo:*')

    expect(unlink).not.toHaveBeenCalled()
  })
})
