import { WORKSPACE_SCREEN_INPUT_MAX_EVENTS, WORKSPACE_SCREEN_INPUT_MAX_TEXT, type WorkspaceScreenInputEventInput } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'
import { DOUBLE_CLICK_MS, InputQueue, textEvents } from './inputQueue'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

/** A fake `…/input` endpoint whose requests finish when the test says so. */
function harness() {
  let now = 1_000
  const batches: WorkspaceScreenInputEventInput[][] = []
  const pending: Array<ReturnType<typeof deferred>> = []
  const errors: unknown[] = []
  let inFlight = 0
  let mostInFlight = 0
  const queue = new InputQueue({
    send: (events) => {
      batches.push(events)
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      const request = deferred()
      pending.push(request)
      return request.promise.finally(() => { inFlight -= 1 })
    },
    onError: (error) => errors.push(error),
    now: () => now,
  })
  const finish = async () => {
    pending.shift()?.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return {
    queue, batches, errors, pending, finish,
    advance: (milliseconds: number) => { now += milliseconds },
    mostInFlight: () => mostInFlight,
  }
}

const click = (x: number, y: number, button: 'left' | 'right' = 'left'): WorkspaceScreenInputEventInput => ({ type: 'click', x, y, button, count: 1 })

describe('InputQueue', () => {
  it('sends in order, one request at a time, batching what happened meanwhile', async () => {
    const h = harness()
    h.queue.push(click(10, 10))
    h.advance(1_000)
    h.queue.push({ type: 'key', keys: 'tab' })
    h.queue.push({ type: 'text', text: 'hello' })
    h.queue.push({ type: 'key', keys: 'enter' })
    expect(h.batches).toEqual([[click(10, 10)]])
    await h.finish()
    expect(h.batches[1]).toEqual([{ type: 'key', keys: 'tab' }, { type: 'text', text: 'hello' }, { type: 'key', keys: 'enter' }])
    await h.finish()
    expect(h.batches).toHaveLength(2)
    expect(h.mostInFlight()).toBe(1)
  })

  it('never sends more events in one request than the server takes', async () => {
    const h = harness()
    h.queue.push({ type: 'key', keys: 'a' })
    for (let index = 0; index < WORKSPACE_SCREEN_INPUT_MAX_EVENTS + 5; index += 1) h.queue.push({ type: 'key', keys: 'right' })
    await h.finish()
    expect(h.batches[1]).toHaveLength(WORKSPACE_SCREEN_INPUT_MAX_EVENTS)
    await h.finish()
    expect(h.batches[2]).toHaveLength(5)
  })

  it('adds up scroll notches at one point while they wait', async () => {
    const h = harness()
    h.queue.push({ type: 'key', keys: 'a' })
    h.queue.push({ type: 'scroll', x: 5, y: 6, dx: 0, dy: 1 })
    h.queue.push({ type: 'scroll', x: 5, y: 6, dx: 0, dy: 2 })
    h.queue.push({ type: 'scroll', x: 9, y: 9, dx: 0, dy: 1 })
    await h.finish()
    expect(h.batches[1]).toEqual([
      { type: 'scroll', x: 5, y: 6, dx: 0, dy: 3 },
      { type: 'scroll', x: 9, y: 9, dx: 0, dy: 1 },
    ])
  })

  it('turns a quick second tap at the same spot into a double click', async () => {
    const h = harness()
    h.queue.push({ type: 'key', keys: 'a' })
    h.queue.push(click(100, 100))
    h.advance(DOUBLE_CLICK_MS - 50)
    h.queue.push(click(103, 98))
    h.advance(DOUBLE_CLICK_MS + 1)
    h.queue.push(click(103, 98))
    await h.finish()
    expect(h.batches[1]).toEqual([{ ...click(100, 100), count: 2 }, click(103, 98)])
  })

  it('keeps taps apart that are slow, far apart or with another button', async () => {
    const h = harness()
    h.queue.push({ type: 'key', keys: 'a' })
    h.queue.push(click(100, 100))
    h.queue.push(click(200, 100))
    h.queue.push(click(200, 100, 'right'))
    await h.finish()
    expect(h.batches[1]).toEqual([click(100, 100), click(200, 100), click(200, 100, 'right')])
  })

  it('drops what waits after a failed request and reports it', async () => {
    const h = harness()
    h.queue.push(click(1, 1))
    h.advance(1_000)
    h.queue.push({ type: 'key', keys: 'enter' })
    const failure = new Error('not controlled')
    h.pending.shift()!.reject(failure)
    await vi.waitFor(() => expect(h.errors).toEqual([failure]))
    expect(h.batches).toHaveLength(1)
    expect(h.queue.pending).toBe(0)
  })

  it('sends nothing more once cleared', async () => {
    const h = harness()
    h.queue.push(click(1, 1))
    h.advance(1_000)
    h.queue.push({ type: 'key', keys: 'enter' })
    h.queue.clear()
    await h.finish()
    expect(h.batches).toHaveLength(1)
  })
})

describe('textEvents', () => {
  it('splits long text without breaking a character', () => {
    const text = `${'a'.repeat(WORKSPACE_SCREEN_INPUT_MAX_TEXT - 1)}😀b`
    const events = textEvents(text)
    expect(events).toEqual([
      { type: 'text', text: `${'a'.repeat(WORKSPACE_SCREEN_INPUT_MAX_TEXT - 1)}😀` },
      { type: 'text', text: 'b' },
    ])
  })

  it('types nothing for nothing', () => {
    expect(textEvents('')).toEqual([])
  })
})
