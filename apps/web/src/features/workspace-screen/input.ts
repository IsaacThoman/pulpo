import {
  WORKSPACE_SCREEN_INPUT_MAX_EVENTS,
  WORKSPACE_SCREEN_INPUT_MAX_TEXT,
  workspaceScreenTextChunks,
  type WorkspaceScreenInputEvent,
} from '@pulpo/contracts'

/**
 * What the viewer does with the user's pointer and keyboard while it holds control of a workspace's
 * screen: where on the screen a pointer is, which key or chord a key press is in the app tools' own
 * words, and how events wait in line for the next input request.
 */

export type ScreenInputEvent = WorkspaceScreenInputEvent
export type ScreenButton = 'left' | 'middle' | 'right'

export interface Box { left: number; top: number; width: number; height: number }
export interface ScreenSize { width: number; height: number }

/** The part of an element a picture of `screen`'s shape fills when it is fitted inside it (`object-fit: contain`). */
export function pictureBox(element: Box, screen: ScreenSize): Box {
  const scale = Math.min(element.width / screen.width, element.height / screen.height)
  const width = screen.width * scale
  const height = screen.height * scale
  return {
    left: element.left + (element.width - width) / 2,
    top: element.top + (element.height - height) / 2,
    width,
    height,
  }
}

/**
 * The screen pixel under a point of the page, given where the picture is drawn. A point outside the
 * picture is moved to its nearest edge, so a drag that leaves the picture still ends on the screen.
 */
export function screenPoint(clientX: number, clientY: number, picture: Box, screen: ScreenSize): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(value)))
  if (picture.width <= 0 || picture.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp((clientX - picture.left) / picture.width * screen.width, screen.width),
    y: clamp((clientY - picture.top) / picture.height * screen.height, screen.height),
  }
}

/** A browser's mouse button number in the screen's words; other buttons (back, forward) are not sent. */
export function pointerButton(button: number): ScreenButton | null {
  return button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : null
}

/** How far the wheel goes for one notch, in the units `WheelEvent.deltaMode` counts: pixels, lines, or pages. */
export function notchSize(deltaMode: number): number {
  return deltaMode === 1 ? 3 : deltaMode === 2 ? 0.25 : 100
}
const MAX_NOTCHES = 20

/**
 * Wheel movement as whole notches. Touchpads report many small deltas, so what is left over of a
 * notch is carried into the next event rather than lost or rounded up to a notch each time.
 */
export function wheelNotches(carry: number, delta: number, unit: number): { notches: number; carry: number } {
  const total = carry + delta / unit
  const notches = Math.max(-MAX_NOTCHES, Math.min(MAX_NOTCHES, Math.trunc(total)))
  return { notches, carry: notches === Math.trunc(total) ? total - notches : 0 }
}

/** Keys that are only ever held with another, and keys that make no input of their own. */
const SILENT_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock', 'CapsLock', 'NumLock',
  'ScrollLock', 'Dead', 'Unidentified', 'Process', 'Compose',
])

const NAMED_KEYS: Record<string, string> = {
  Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape', Esc: 'escape', Delete: 'delete',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space', Spacebar: 'space',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `f${index + 1}`])),
}

export interface KeyPress {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  /** AltGr is held: on many layouts it is how `@`, `€` or `{` are typed, and the browser reports it as Ctrl+Alt. */
  altGraph?: boolean
  isComposing?: boolean
}

/** The character a chord names: the letter or digit of the key (not what Shift made of it), else the character itself. */
function chordCharacter(key: string, code?: string): string {
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase()
  const letter = code?.match(/^Key([A-Z])$/)?.[1] ?? code?.match(/^Digit([0-9])$/)?.[1]
  return letter ? letter.toLowerCase() : key.toLowerCase()
}

/**
 * One key press in the app tools' words, or null when it sends nothing (a modifier on its own, a
 * dead key, a key the screen has no name for). A character typed without Ctrl, Alt or Meta is text;
 * on a Mac, Option is how characters such as `ø` are typed, so it is text there too. On a Mac the
 * Command key is sent as `ctrl`, so ⌘C, ⌘V and ⌘A do in the workspace's Linux apps what they do on
 * the Mac.
 */
export function keyInput(press: KeyPress, mac: boolean): ScreenInputEvent | null {
  if (press.isComposing || SILENT_KEYS.has(press.key)) return null
  const printable = [...press.key].length === 1
  const ctrl = press.ctrlKey || (mac && press.metaKey)
  const cmd = !mac && press.metaKey
  const alt = press.altKey
  const typesCharacter = press.altGraph || (!ctrl && !cmd && (!alt || mac))
  if (printable && typesCharacter) return { type: 'text', text: press.key }
  const name = NAMED_KEYS[press.key] ?? (printable ? chordCharacter(press.key, press.code) : null)
  if (!name) return null
  const modifiers = [ctrl && 'ctrl', alt && 'alt', press.shiftKey && 'shift', cmd && 'cmd'].filter(Boolean)
  return { type: 'key', keys: [...modifiers, name].join('+') }
}

/** The modifier a paste shortcut uses: ⌘V on a Mac, Ctrl+V elsewhere (and Shift+Insert). */
export function isPasteShortcut(press: KeyPress, mac: boolean): boolean {
  if (press.key === 'Insert' && press.shiftKey) return true
  const modifier = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey
  return modifier && !press.altKey && chordCharacter(press.key, press.code) === 'v'
}

/** Pasted text as text events: line endings as the screen expects them, and no event longer than the most one may type. */
export function pasteEvents(text: string): ScreenInputEvent[] {
  return workspaceScreenTextChunks(text.replace(/\r\n?/g, '\n')).map((chunk) => ({ type: 'text', text: chunk }))
}

/**
 * Adds an event to those waiting to be sent, folding it into the last one where nothing is lost by
 * that: a move replaces a move (only where the pointer ends up matters, so a slow network does not
 * build a backlog), characters join the text before them, and wheel notches at the same point add up.
 */
export function enqueueInput(queue: ScreenInputEvent[], event: ScreenInputEvent): ScreenInputEvent[] {
  const last = queue.at(-1)
  if (last?.type === 'move' && event.type === 'move') return [...queue.slice(0, -1), event]
  if (last?.type === 'text' && event.type === 'text' && last.text.length + event.text.length <= WORKSPACE_SCREEN_INPUT_MAX_TEXT) {
    return [...queue.slice(0, -1), { type: 'text', text: last.text + event.text }]
  }
  if (last?.type === 'scroll' && event.type === 'scroll' && last.x === event.x && last.y === event.y) {
    const dx = last.dx + event.dx
    const dy = last.dy + event.dy
    if (Math.abs(dx) <= MAX_NOTCHES && Math.abs(dy) <= MAX_NOTCHES && (dx !== 0 || dy !== 0)) {
      return [...queue.slice(0, -1), { ...last, dx, dy }]
    }
  }
  return [...queue, event]
}

/** The next request's events, oldest first, and what stays behind for the one after. */
export function takeInputBatch(queue: ScreenInputEvent[], max = WORKSPACE_SCREEN_INPUT_MAX_EVENTS): [ScreenInputEvent[], ScreenInputEvent[]] {
  return [queue.slice(0, max), queue.slice(max)]
}

/**
 * Sends input in order, one request at a time: whatever happens while a request is out waits and
 * goes in the next one. A request that fails is not sent again, since its clicks and keys may have
 * been carried out already; `onError` decides what the viewer makes of it.
 */
export class InputSender {
  private queue: ScreenInputEvent[] = []
  private sending = false
  private stopped = false

  private readonly send: (events: ScreenInputEvent[]) => Promise<void>
  private readonly onError: (error: unknown) => void

  constructor(send: (events: ScreenInputEvent[]) => Promise<void>, onError: (error: unknown) => void) {
    this.send = send
    this.onError = onError
  }

  push(event: ScreenInputEvent): void {
    if (this.stopped) return
    this.queue = enqueueInput(this.queue, event)
    void this.pump()
  }

  /** Drops what is waiting and sends nothing more. */
  stop(): void {
    this.stopped = true
    this.queue = []
  }

  get pending(): number {
    return this.queue.length
  }

  get busy(): boolean {
    return this.sending
  }

  private async pump(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      while (!this.stopped && this.queue.length > 0) {
        const [batch, rest] = takeInputBatch(this.queue)
        this.queue = rest
        try {
          await this.send(batch)
        } catch (error) {
          if (!this.stopped) this.onError(error)
        }
      }
    } finally {
      this.sending = false
    }
  }
}

/** How often moves are sent while no button is down: enough to show hover effects, not a stream. */
export const HOVER_MOVE_INTERVAL_MS = 250

/** A finger has to travel this far, in page pixels, before a touch is a scroll rather than a tap. */
export const TAP_SLOP_PX = 10
/** Page pixels a finger travels for one wheel notch. */
export const TOUCH_NOTCH_PX = 40
