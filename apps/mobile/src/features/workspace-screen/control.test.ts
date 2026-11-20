import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlSession } from './control'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function session(post: (held: boolean) => Promise<boolean>) {
  const changes: Array<[boolean, string | undefined]> = []
  const posts: boolean[] = []
  const control = new ControlSession({
    post: (held) => {
      posts.push(held)
      return post(held)
    },
    onChange: (held, loss) => changes.push([held, loss]),
    renewMs: 5_000,
  })
  return { control, changes, posts }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ControlSession', () => {
  it('takes control and renews it while held', async () => {
    const { control, changes, posts } = session(async () => true)
    expect(await control.take()).toBe('held')
    expect(control.isHeld).toBe(true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(posts).toEqual([true, true, true, true])
    expect(changes).toEqual([[true, undefined]])
  })

  it('hands control back and stops renewing', async () => {
    const { control, changes, posts } = session(async () => true)
    await control.take()
    control.release()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(posts).toEqual([true, false])
    expect(changes).toEqual([[true, undefined], [false, undefined]])
  })

  it('falls back to watching when a renewal fails', async () => {
    let calls = 0
    const { control, changes } = session(async () => {
      calls += 1
      if (calls === 2) throw new Error('offline')
      return true
    })
    await control.take()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(control.isHeld).toBe(false)
    expect(changes).toEqual([[true, undefined], [false, 'lost']])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(calls).toBe(2)
  })

  it('falls back to watching when the server stops holding it', async () => {
    let calls = 0
    const { control, changes } = session(async () => (calls += 1) === 1)
    await control.take()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(changes.at(-1)).toEqual([false, 'lost'])
  })

  it('reports a refusal without holding anything', async () => {
    const { control, changes } = session(async () => false)
    expect(await control.take()).toBe('refused')
    expect(control.isHeld).toBe(false)
    expect(changes).toEqual([])
  })

  it('gives back control that arrives after the viewer let go', async () => {
    const answer = deferred<boolean>()
    const { control, changes, posts } = session((held) => held ? answer.promise : Promise.resolve(false))
    const taking = control.take()
    control.release()
    answer.resolve(true)
    expect(await taking).toBe('cancelled')
    expect(posts).toEqual([true, false])
    expect(control.isHeld).toBe(false)
    expect(changes).toEqual([])
  })

  it('watches again without asking when an input was refused', async () => {
    const { control, changes, posts } = session(async () => true)
    await control.take()
    control.lose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(posts).toEqual([true])
    expect(changes).toEqual([[true, undefined], [false, 'lost']])
  })

  it('does not lose control to a renewal answer that arrives after a new take', async () => {
    const renewal = deferred<boolean>()
    let calls = 0
    const { control, changes } = session(() => {
      calls += 1
      return calls === 2 ? renewal.promise : Promise.resolve(true)
    })
    await control.take()
    await vi.advanceTimersByTimeAsync(5_000)
    control.release()
    await control.take()
    renewal.reject(new Error('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(control.isHeld).toBe(true)
    expect(changes.map(([held]) => held)).toEqual([true, false, true])
  })
})
