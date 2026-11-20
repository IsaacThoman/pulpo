import { describe, expect, it, vi } from 'vitest'
import { frameRetryDelay, startFrameLoop, type FrameAnswer } from './frameLoop'

const bytes = (value: number) => new Uint8Array([value])

/** A fake `…/frame` endpoint: each request takes the next scripted answer, or waits to be stopped. */
function scripted(answers: Array<FrameAnswer | Error>) {
  const requests: Array<{ after: string | undefined; waitMs: number }> = []
  const fetchFrame = vi.fn((after: string | undefined, waitMs: number, signal: AbortSignal) => {
    requests.push({ after, waitMs })
    const next = answers.shift()
    if (next instanceof Error) return Promise.reject(next)
    if (next) return Promise.resolve(next)
    return new Promise<FrameAnswer>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  })
  return { fetchFrame, requests }
}

function callbacks() {
  return {
    frames: [] as string[],
    connection: [] as boolean[],
    gone: 0,
    unfunded: 0,
    sleeps: [] as number[],
  }
}

function start(answers: Array<FrameAnswer | Error>) {
  const fake = scripted(answers)
  const seen = callbacks()
  const loop = startFrameLoop({
    fetchFrame: fake.fetchFrame,
    onFrame: (frame) => seen.frames.push(frame.id),
    onGone: () => { seen.gone += 1 },
    onUnfunded: () => { seen.unfunded += 1 },
    onConnection: (connected) => seen.connection.push(connected),
    waitMs: 5_000,
    sleep: async (milliseconds) => { seen.sleeps.push(milliseconds) },
  })
  return { ...fake, seen, loop }
}

describe('startFrameLoop', () => {
  it('shows each new picture and asks for the next one after it', async () => {
    const { requests, seen, loop } = start([
      { kind: 'frame', id: 'aaaaaaaa', bytes: bytes(1) },
      { kind: 'unchanged' },
      { kind: 'frame', id: 'bbbbbbbb', bytes: bytes(2) },
    ])
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    loop.stop()
    await loop.done
    expect(seen.frames).toEqual(['aaaaaaaa', 'bbbbbbbb'])
    expect(requests).toEqual([
      { after: undefined, waitMs: 5_000 },
      { after: 'aaaaaaaa', waitMs: 5_000 },
      { after: 'aaaaaaaa', waitMs: 5_000 },
      { after: 'bbbbbbbb', waitMs: 5_000 },
    ])
  })

  it('stops for good once the workspace is gone', async () => {
    const { requests, seen, loop } = start([{ kind: 'frame', id: 'aaaaaaaa', bytes: bytes(1) }, { kind: 'gone' }])
    await loop.done
    expect(seen.gone).toBe(1)
    expect(requests).toHaveLength(2)
  })

  it('stops for good, without retrying, once the screen is unfunded', async () => {
    const { requests, seen, loop } = start([{ kind: 'frame', id: 'aaaaaaaa', bytes: bytes(1) }, { kind: 'unfunded' }])
    await loop.done
    expect(seen.unfunded).toBe(1)
    expect(seen.gone).toBe(0)
    expect(seen.sleeps).toEqual([])
    expect(requests).toHaveLength(2)
  })

  it('backs off while requests fail and says when they answer again', async () => {
    const failure = new Error('offline')
    const { seen, loop } = start([failure, failure, failure, { kind: 'unchanged' }, { kind: 'gone' }])
    await loop.done
    expect(seen.sleeps).toEqual([1_000, 2_000, 4_000])
    expect(seen.connection).toEqual([false, true])
  })

  it('cancels the request in flight when stopped, without reporting it as a failure', async () => {
    const { requests, seen, loop } = start([])
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    loop.stop()
    await loop.done
    expect(seen.connection).toEqual([])
    expect(seen.frames).toEqual([])
  })

  it('drops an answer that arrives after it was stopped', async () => {
    let answer!: (value: FrameAnswer) => void
    const seen = callbacks()
    const loop = startFrameLoop({
      fetchFrame: () => new Promise((resolve) => { answer = resolve }),
      onFrame: (frame) => seen.frames.push(frame.id),
      onGone: () => { seen.gone += 1 },
      onUnfunded: () => { seen.unfunded += 1 },
      onConnection: (connected) => seen.connection.push(connected),
    })
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    loop.stop()
    answer({ kind: 'frame', id: 'aaaaaaaa', bytes: bytes(1) })
    await loop.done
    expect(seen.frames).toEqual([])
  })
})

describe('frameRetryDelay', () => {
  it('grows and then stays at its longest', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(frameRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000])
  })
})
