import { describe, expect, it, vi } from 'vitest'
import { frameBackoffMs, runFrameLoop, type FrameAnswer } from './frame-loop'

const image = (name: string) => new Blob([name], { type: 'image/jpeg' })

/** A fake server: answers in turn, then holds the next request until the loop is stopped. */
function script(answers: Array<FrameAnswer | Error>) {
  const requests: Array<{ after: string | undefined; waitMs: number }> = []
  const fetchFrame = vi.fn((after: string | undefined, waitMs: number, signal: AbortSignal) => {
    requests.push({ after, waitMs })
    const next = answers.shift()
    if (!next) return new Promise<FrameAnswer>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  return { fetchFrame, requests }
}

describe('runFrameLoop', () => {
  it('shows each new picture and waits past the one shown', async () => {
    const { fetchFrame, requests } = script([
      { kind: 'frame', id: 'aaaaaaaa', image: image('one') },
      { kind: 'unchanged' },
      { kind: 'frame', id: 'bbbbbbbb', image: image('two') },
    ])
    const onFrame = vi.fn()
    const abort = new AbortController()
    const done = runFrameLoop({ fetchFrame, onFrame, onGone: vi.fn(), waitMs: 5_000 }, abort.signal)
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    abort.abort()
    await done
    expect(requests).toEqual([
      { after: undefined, waitMs: 0 },
      { after: 'aaaaaaaa', waitMs: 5_000 },
      { after: 'aaaaaaaa', waitMs: 5_000 },
      { after: 'bbbbbbbb', waitMs: 5_000 },
    ])
    expect(onFrame.mock.calls.map(([, id]) => id)).toEqual(['aaaaaaaa', 'bbbbbbbb'])
  })

  it('starts again from the picture already shown', async () => {
    const { fetchFrame, requests } = script([])
    const abort = new AbortController()
    const done = runFrameLoop({ fetchFrame, onFrame: vi.fn(), onGone: vi.fn(), waitMs: 5_000 }, abort.signal, 'cccccccc')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    abort.abort()
    await done
    expect(requests[0]).toEqual({ after: 'cccccccc', waitMs: 5_000 })
  })

  it('stops when the workspace is gone', async () => {
    const { fetchFrame } = script([{ kind: 'frame', id: 'aaaaaaaa', image: image('one') }, { kind: 'gone' }])
    const onGone = vi.fn()
    await runFrameLoop({ fetchFrame, onFrame: vi.fn(), onGone }, new AbortController().signal)
    expect(onGone).toHaveBeenCalledOnce()
    expect(fetchFrame).toHaveBeenCalledTimes(2)
  })

  it('backs off after failures, longer each time, and says when it recovers', async () => {
    const { fetchFrame } = script([new TypeError('offline'), new TypeError('offline'), new TypeError('offline'), { kind: 'gone' }])
    const sleeps: number[] = []
    const onError = vi.fn()
    const onRecovered = vi.fn()
    await runFrameLoop({
      fetchFrame, onFrame: vi.fn(), onGone: vi.fn(), onError, onRecovered,
      sleep: async (ms) => { sleeps.push(ms) },
    }, new AbortController().signal)
    expect(sleeps).toEqual([500, 1_000, 2_000])
    expect(onError.mock.calls.map(([, failures]) => failures)).toEqual([1, 2, 3])
    expect(onRecovered).toHaveBeenCalledOnce()
  })

  it('caps the backoff at ten seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(frameBackoffMs)).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000])
  })

  it('pauses between frames that have no name rather than asking again at once', async () => {
    const { fetchFrame, requests } = script([{ kind: 'frame', id: null, image: image('one') }, { kind: 'gone' }])
    const sleeps: number[] = []
    await runFrameLoop({ fetchFrame, onFrame: vi.fn(), onGone: vi.fn(), sleep: async (ms) => { sleeps.push(ms) } }, new AbortController().signal)
    expect(sleeps).toEqual([250])
    expect(requests[1]).toEqual({ after: undefined, waitMs: 0 })
  })

  it('says nothing about a request it stopped itself', async () => {
    const { fetchFrame } = script([])
    const onError = vi.fn()
    const abort = new AbortController()
    const done = runFrameLoop({ fetchFrame, onFrame: vi.fn(), onGone: vi.fn(), onError }, abort.signal)
    await vi.waitFor(() => expect(fetchFrame).toHaveBeenCalledOnce())
    abort.abort()
    await done
    expect(onError).not.toHaveBeenCalled()
  })
})
