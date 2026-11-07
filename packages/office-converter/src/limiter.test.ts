import { describe, expect, it } from 'vitest'
import { BusyError, JobLimiter } from './limiter.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('job limiter', () => {
  it('runs at most `concurrency` jobs, queues the rest in order, and refuses beyond the queue', async () => {
    const limiter = new JobLimiter(2, 1)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const jobs = gates.map((gate, index) => limiter.run(async () => { started.push(index); await gate.promise; return index }))
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(limiter.stats).toEqual({ running: 2, queued: 1 })
    await expect(limiter.run(async () => 99)).rejects.toBeInstanceOf(BusyError)
    gates[0]!.resolve()
    await jobs[0]
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([0, 1, 2])
    gates[1]!.resolve()
    gates[2]!.resolve()
    expect(await Promise.all(jobs)).toEqual([0, 1, 2])
    expect(limiter.stats).toEqual({ running: 0, queued: 0 })
  })

  it('frees the slot when a job fails', async () => {
    const limiter = new JobLimiter(1, 0)
    await expect(limiter.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await limiter.run(async () => 'next')).toBe('next')
  })

  it('drops a queued job whose request went away', async () => {
    const limiter = new JobLimiter(1, 5)
    const gate = deferred()
    const first = limiter.run(() => gate.promise)
    const controller = new AbortController()
    let ran = false
    const queued = limiter.run(async () => { ran = true }, controller.signal)
    expect(limiter.stats.queued).toBe(1)
    controller.abort(new Error('client left'))
    await expect(queued).rejects.toThrow('client left')
    expect(limiter.stats.queued).toBe(0)
    gate.resolve()
    await first
    expect(ran).toBe(false)
    expect(limiter.stats).toEqual({ running: 0, queued: 0 })
  })
})
