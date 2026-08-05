import { describe, expect, it, vi } from 'vitest'
import { enqueueCacheWrite, flushCacheWrites } from './writeBehind'

describe('cache write-behind queue', () => {
  it('returns immediately while preserving write order per namespace', async () => {
    const steps: string[] = []
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })

    enqueueCacheWrite('account-a', async () => { steps.push('first:start'); await first; steps.push('first:end') })
    enqueueCacheWrite('account-a', async () => { steps.push('second') })
    await Promise.resolve()
    await Promise.resolve()
    expect(steps).toEqual(['first:start'])

    releaseFirst()
    await flushCacheWrites('account-a')
    expect(steps).toEqual(['first:start', 'first:end', 'second'])
  })

  it('continues after a failed write', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const steps: string[] = []
    enqueueCacheWrite('account-b', async () => { throw new Error('disk full') })
    enqueueCacheWrite('account-b', async () => { steps.push('recovered') })
    await flushCacheWrites('account-b')
    expect(steps).toEqual(['recovered'])
    warning.mockRestore()
  })
})
