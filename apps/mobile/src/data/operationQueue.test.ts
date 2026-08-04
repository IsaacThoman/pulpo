import { describe, expect, it } from 'vitest'
import { createOperationQueue } from './operationQueue'

describe('createOperationQueue', () => {
  it('runs asynchronous operations serially in submission order', async () => {
    const enqueue = createOperationQueue()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = enqueue(async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
    })
    const second = enqueue(async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('continues after an operation rejects', async () => {
    const enqueue = createOperationQueue()
    await expect(enqueue(async () => { throw new Error('expected') })).rejects.toThrow('expected')
    await expect(enqueue(async () => 42)).resolves.toBe(42)
  })
})
