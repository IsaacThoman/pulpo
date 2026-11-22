import { WORKSPACE_SCREEN_INPUT_MAX_EVENTS, WORKSPACE_SCREEN_INPUT_MAX_TEXT, workspaceScreenInputSchema } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  InputSender,
  enqueueInput,
  isPasteShortcut,
  keyInput,
  notchSize,
  pasteEvents,
  pictureBox,
  pointerButton,
  screenPoint,
  takeInputBatch,
  wheelNotches,
  type KeyPress,
  type ScreenInputEvent,
} from './input'

const screen = { width: 1280, height: 800 }
const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...extra })

describe('screen coordinates', () => {
  it('fits the picture inside its element, centred, keeping the screen shape', () => {
    expect(pictureBox({ left: 0, top: 0, width: 640, height: 400 }, screen)).toEqual({ left: 0, top: 0, width: 640, height: 400 })
    // Too tall: bands above and below.
    expect(pictureBox({ left: 10, top: 20, width: 640, height: 600 }, screen)).toEqual({ left: 10, top: 120, width: 640, height: 400 })
    // Too wide: bands left and right.
    expect(pictureBox({ left: 0, top: 0, width: 1000, height: 400 }, screen)).toEqual({ left: 180, top: 0, width: 640, height: 400 })
  })

  it('maps a point on the drawn picture to a screen pixel', () => {
    const picture = { left: 100, top: 50, width: 640, height: 400 }
    expect(screenPoint(100, 50, picture, screen)).toEqual({ x: 0, y: 0 })
    expect(screenPoint(420, 250, picture, screen)).toEqual({ x: 640, y: 400 })
    expect(screenPoint(100 + 320.4, 50 + 0.3, picture, screen)).toEqual({ x: 641, y: 1 })
  })

  it('keeps a point outside the picture on the nearest edge of the screen', () => {
    const picture = { left: 0, top: 0, width: 640, height: 400 }
    expect(screenPoint(-30, 900, picture, screen)).toEqual({ x: 0, y: 799 })
    expect(screenPoint(640, 400, picture, screen)).toEqual({ x: 1279, y: 799 })
  })

  it('names the three buttons and drops the others', () => {
    expect([0, 1, 2, 3, 4].map(pointerButton)).toEqual(['left', 'middle', 'right', null, null])
  })
})

describe('wheel notches', () => {
  it('counts whole notches and carries what is left of one', () => {
    let carry = 0
    const notches: number[] = []
    for (let step = 0; step < 5; step += 1) {
      const result = wheelNotches(carry, 40, notchSize(0))
      carry = result.carry
      notches.push(result.notches)
    }
    expect(notches).toEqual([0, 0, 1, 0, 1])
    expect(wheelNotches(0, -250, 100)).toEqual({ notches: -2, carry: -0.5 })
  })

  it('reads lines and pages, and sends at most twenty notches at once', () => {
    expect(wheelNotches(0, 3, notchSize(1)).notches).toBe(1)
    expect(wheelNotches(0, 1, notchSize(2)).notches).toBe(4)
    expect(wheelNotches(0, 10_000, 100)).toEqual({ notches: 20, carry: 0 })
  })
})

describe('key input', () => {
  it('types characters as text', () => {
    expect(keyInput(press('a'), false)).toEqual({ type: 'text', text: 'a' })
    expect(keyInput(press('A', { shiftKey: true }), false)).toEqual({ type: 'text', text: 'A' })
    expect(keyInput(press(' '), false)).toEqual({ type: 'text', text: ' ' })
    expect(keyInput(press('é'), false)).toEqual({ type: 'text', text: 'é' })
    expect(keyInput(press('😀'), false)).toEqual({ type: 'text', text: '😀' })
  })

  it('names other keys in the app tools’ words', () => {
    const names = ['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'F1', 'F12']
    expect(names.map((key) => keyInput(press(key), false))).toEqual(
      ['enter', 'backspace', 'tab', 'escape', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'f1', 'f12'].map((keys) => ({ type: 'key', keys })),
    )
    expect(keyInput(press('Tab', { shiftKey: true }), false)).toEqual({ type: 'key', keys: 'shift+tab' })
  })

  it('sends chords with the modifiers in a fixed order and the key’s own letter', () => {
    expect(keyInput(press('a', { ctrlKey: true }), false)).toEqual({ type: 'key', keys: 'ctrl+a' })
    expect(keyInput(press('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' }), false)).toEqual({ type: 'key', keys: 'ctrl+shift+t' })
    expect(keyInput(press('!', { ctrlKey: true, shiftKey: true, code: 'Digit1' }), false)).toEqual({ type: 'key', keys: 'ctrl+shift+1' })
    expect(keyInput(press('ф', { ctrlKey: true, code: 'KeyA' }), false)).toEqual({ type: 'key', keys: 'ctrl+a' })
    expect(keyInput(press('ArrowLeft', { altKey: true }), false)).toEqual({ type: 'key', keys: 'alt+left' })
    expect(keyInput(press(' ', { ctrlKey: true }), false)).toEqual({ type: 'key', keys: 'ctrl+space' })
    expect(keyInput(press('s', { metaKey: true }), false)).toEqual({ type: 'key', keys: 'cmd+s' })
  })

  it('sends Command as ctrl on a Mac, and lets Option type characters there', () => {
    expect(keyInput(press('c', { metaKey: true }), true)).toEqual({ type: 'key', keys: 'ctrl+c' })
    expect(keyInput(press('a', { metaKey: true }), true)).toEqual({ type: 'key', keys: 'ctrl+a' })
    expect(keyInput(press('ø', { altKey: true }), true)).toEqual({ type: 'text', text: 'ø' })
    expect(keyInput(press('ArrowLeft', { altKey: true }), true)).toEqual({ type: 'key', keys: 'alt+left' })
    // Elsewhere Alt with a letter is a shortcut, unless it is AltGr typing a character.
    expect(keyInput(press('f', { altKey: true }), false)).toEqual({ type: 'key', keys: 'alt+f' })
    expect(keyInput(press('@', { ctrlKey: true, altKey: true, altGraph: true }), false)).toEqual({ type: 'text', text: '@' })
  })

  it('sends nothing for a modifier on its own, a dead key, or a key the screen has no name for', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified', 'PrintScreen', 'ContextMenu']) {
      expect(keyInput(press(key), false)).toBeNull()
    }
    expect(keyInput(press('a', { isComposing: true }), false)).toBeNull()
  })

  it('leaves the paste shortcut to the browser so the user’s own clipboard is pasted', () => {
    expect(isPasteShortcut(press('v', { metaKey: true }), true)).toBe(true)
    expect(isPasteShortcut(press('v', { ctrlKey: true }), true)).toBe(false)
    expect(isPasteShortcut(press('v', { ctrlKey: true }), false)).toBe(true)
    expect(isPasteShortcut(press('V', { ctrlKey: true, shiftKey: true, code: 'KeyV' }), false)).toBe(true)
    expect(isPasteShortcut(press('Insert', { shiftKey: true }), false)).toBe(true)
    expect(isPasteShortcut(press('c', { ctrlKey: true }), false)).toBe(false)
  })

  it('turns pasted text into text events no longer than one may be', () => {
    expect(pasteEvents('one\r\ntwo\rthree')).toEqual([{ type: 'text', text: 'one\ntwo\nthree' }])
    const long = 'x'.repeat(WORKSPACE_SCREEN_INPUT_MAX_TEXT + 5)
    expect(pasteEvents(long).map((event) => event.type === 'text' && event.text.length)).toEqual([WORKSPACE_SCREEN_INPUT_MAX_TEXT, 5])
    expect(pasteEvents('')).toEqual([])
  })
})

describe('input queue', () => {
  const move = (x: number): ScreenInputEvent => ({ type: 'move', x, y: 10 })

  it('keeps only the last of consecutive moves', () => {
    let queue: ScreenInputEvent[] = []
    for (const x of [1, 2, 3]) queue = enqueueInput(queue, move(x))
    queue = enqueueInput(queue, { type: 'down', x: 3, y: 10, button: 'left' })
    for (const x of [4, 5]) queue = enqueueInput(queue, move(x))
    expect(queue).toEqual([move(3), { type: 'down', x: 3, y: 10, button: 'left' }, move(5)])
  })

  it('joins typed characters and adds up notches at one point', () => {
    let queue: ScreenInputEvent[] = []
    for (const text of ['h', 'i', '!']) queue = enqueueInput(queue, { type: 'text', text })
    queue = enqueueInput(queue, { type: 'key', keys: 'enter' })
    queue = enqueueInput(queue, { type: 'text', text: 'x' })
    expect(queue).toEqual([{ type: 'text', text: 'hi!' }, { type: 'key', keys: 'enter' }, { type: 'text', text: 'x' }])

    let scrolls: ScreenInputEvent[] = []
    scrolls = enqueueInput(scrolls, { type: 'scroll', x: 5, y: 5, dx: 0, dy: 2 })
    scrolls = enqueueInput(scrolls, { type: 'scroll', x: 5, y: 5, dx: 0, dy: 3 })
    scrolls = enqueueInput(scrolls, { type: 'scroll', x: 6, y: 5, dx: 0, dy: 1 })
    expect(scrolls).toEqual([{ type: 'scroll', x: 5, y: 5, dx: 0, dy: 5 }, { type: 'scroll', x: 6, y: 5, dx: 0, dy: 1 }])
  })

  it('does not join past what one event may carry, or scrolls that cancel out', () => {
    const full = 'x'.repeat(WORKSPACE_SCREEN_INPUT_MAX_TEXT)
    expect(enqueueInput([{ type: 'text', text: full }], { type: 'text', text: 'y' })).toHaveLength(2)
    expect(enqueueInput([{ type: 'scroll', x: 1, y: 1, dx: 0, dy: 18 }], { type: 'scroll', x: 1, y: 1, dx: 0, dy: 5 })).toHaveLength(2)
    expect(enqueueInput([{ type: 'scroll', x: 1, y: 1, dx: 0, dy: 2 }], { type: 'scroll', x: 1, y: 1, dx: 0, dy: -2 })).toHaveLength(2)
  })

  it('takes batches of at most the most one request carries, in order', () => {
    const queue = Array.from({ length: WORKSPACE_SCREEN_INPUT_MAX_EVENTS + 3 }, (_, index): ScreenInputEvent => ({ type: 'key', keys: `f${(index % 12) + 1}` }))
    const [batch, rest] = takeInputBatch(queue)
    expect(batch).toEqual(queue.slice(0, WORKSPACE_SCREEN_INPUT_MAX_EVENTS))
    expect(rest).toEqual(queue.slice(WORKSPACE_SCREEN_INPUT_MAX_EVENTS))
  })
})

describe('InputSender', () => {
  function deferredSend() {
    const calls: Array<{ events: ScreenInputEvent[]; resolve: () => void; reject: (error: unknown) => void }> = []
    const send = vi.fn((events: ScreenInputEvent[]) => new Promise<void>((resolve, reject) => { calls.push({ events, resolve, reject }) }))
    return { calls, send }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('sends one request at a time, with what happened meanwhile folded into the next', async () => {
    const { calls, send } = deferredSend()
    const sender = new InputSender(send, vi.fn())
    sender.push({ type: 'down', x: 1, y: 1, button: 'left' })
    for (const x of [2, 3, 4, 5]) sender.push({ type: 'move', x, y: 1 })
    sender.push({ type: 'up', x: 5, y: 1, button: 'left' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.events).toEqual([{ type: 'down', x: 1, y: 1, button: 'left' }])
    calls[0]!.resolve()
    await settle()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.events).toEqual([{ type: 'move', x: 5, y: 1 }, { type: 'up', x: 5, y: 1, button: 'left' }])
    calls[1]!.resolve()
    await settle()
    expect(sender.busy).toBe(false)
    // Every request is one the server accepts.
    for (const call of calls) expect(workspaceScreenInputSchema.safeParse({ events: call.events }).success).toBe(true)
  })

  it('reports a failed request once, does not send it again, and goes on with the rest', async () => {
    const { calls, send } = deferredSend()
    const onError = vi.fn()
    const sender = new InputSender(send, onError)
    sender.push({ type: 'key', keys: 'enter' })
    sender.push({ type: 'text', text: 'a' })
    calls[0]!.reject(new Error('offline'))
    await settle()
    expect(onError).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.events).toEqual([{ type: 'text', text: 'a' }])
  })

  it('drops what is waiting once stopped', async () => {
    const { calls, send } = deferredSend()
    const onError = vi.fn()
    const sender = new InputSender(send, onError)
    sender.push({ type: 'text', text: 'a' })
    sender.push({ type: 'text', text: 'b' })
    sender.stop()
    calls[0]!.reject(new Error('late'))
    await settle()
    sender.push({ type: 'text', text: 'c' })
    expect(calls).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
    expect(sender.pending).toBe(0)
  })
})
