/**
 * What the main process says to the native helper that sees and controls other apps, and what the
 * helper answers. There is one helper per system (`apps/desktop/native/macos`, a Swift program;
 * `apps/desktop/native/windows`, C# loaded by Windows PowerShell), and both speak exactly this.
 *
 * Transport: one JSON object per line. Requests arrive on the helper's standard input and each is
 * answered with one line on its standard output, in order; standard error is for diagnostics. The
 * helper exits when its input closes, so it never outlives the app.
 *
 *   → {"id":1,"method":"apps","params":{}}
 *   ← {"id":1,"ok":true,"result":{"apps":[…]}}
 *   ← {"id":1,"ok":false,"code":"not_found","message":"The window is gone."}
 *
 * The helper decides nothing about what is allowed: the main process asks it only for apps the user
 * approved. It never reports or touches the windows of the processes named in `configure`.
 */

export const CONTROL_PROTOCOL_VERSION = 1

export type ControlErrorCode =
  /** macOS has not given Pulpo Accessibility or Screen Recording; the message names which. Never on Windows. */
  | 'permission_denied'
  /** The process or window is gone. */
  | 'not_found'
  /** `element` does not name an element of the window's latest snapshot, or that element is gone. */
  | 'stale_element'
  | 'invalid_request'
  /** The system cannot do this (an action an element does not offer, a window that cannot be captured). */
  | 'unsupported'
  | 'failed'

export interface ControlRequest<M extends ControlMethod = ControlMethod> { id: number; method: M; params: ControlParams<M> }
export type ControlResponse<M extends ControlMethod = ControlMethod> =
  | { id: number; ok: true; result: ControlResult<M> }
  | { id: number; ok: false; code: ControlErrorCode; message: string }

export interface ControlApp {
  /**
   * What stays the same from one run of the app to the next, and what an approval is kept under:
   * the bundle identifier on macOS (the executable's path when it has none), the executable's file
   * name in lower case on Windows (`notepad.exe`; for an app hosted by ApplicationFrameHost, the
   * hosted app's).
   */
  id: string
  /** As the user knows it: `TextEdit`, `Notepad`. */
  name: string
  pid: number
  /** The app the user is working in. */
  frontmost: boolean
  /** Its ordinary windows, front to back. Apps without one are not listed. */
  windows: ControlWindow[]
}

export interface ControlWindow {
  /** The system's own number for the window (CGWindowID, HWND). */
  id: number
  title: string
  minimized: boolean
}

/**
 * One element of a window, for the agent to read and to name in an action. `x`, `y`, `width` and
 * `height` are in the pixels of the snapshot's image, like every coordinate the agent sends back.
 */
export interface ControlElement {
  /** Names the element in `act`, until the window's next snapshot. Counts from 1 in outline order. */
  index: number
  /** How deep it sits below the elements listed before it; 0 for the top. */
  depth: number
  /**
   * Short and lower case, the same words on both systems where they mean the same: button,
   * checkbox, radio, textfield, textarea, text, link, menu, menubar, menuitem, menubutton, combobox,
   * list, row, cell, table, tree, tab, tablist, slider, stepper, image, toolbar, titlebar, group,
   * scrollarea, document, window, … A role with no shared word is the system's own name for it.
   */
  role: string
  /** Its name or title, at most 160 characters. */
  label?: string
  /** What it holds (a field's text, a checkbox's state), at most 160 characters. */
  value?: string
  x: number
  y: number
  width: number
  height: number
  /** Has the keyboard focus. */
  focused?: boolean
  /** Present and false when it is disabled. */
  enabled?: boolean
}

export interface ControlSnapshot {
  window: ControlWindow
  /** A JPEG of the window alone (never the rest of the screen), written into `imageDir`. Its size is the coordinate space. */
  image: { path: string; width: number; height: number; mimeType: 'image/jpeg' }
  /** Depth-first. Empty when `outline` was false. */
  elements: ControlElement[]
  /** The window has more elements than `maxElements`. */
  truncated: boolean
}

/** Coordinates are pixels of the window's latest snapshot image. */
export type ControlAction =
  /**
   * With `element`: its own press action when the click is a single left click and it has one
   * (macOS AXPress, Windows Invoke/Toggle/Select/Expand), else a click at its middle. With `x`/`y`:
   * a click there.
   */
  | { type: 'click'; element?: number; x?: number; y?: number; button: 'left' | 'right' | 'middle'; count: 1 | 2 | 3 }
  /**
   * Types into whatever has the keyboard focus in the window, as text (not as key codes), so any
   * character works. Windows takes about 15 ms a character (its apps drop or reorder faster input);
   * macOS sends a few characters per event.
   */
  | { type: 'type'; text: string }
  /**
   * One key or chord: `enter`, `escape`, `tab`, `space`, `backspace`, `delete`, `up`/`down`/`left`/`right`,
   * `home`, `end`, `pageup`, `pagedown`, `f1`…`f12`, a single character, with any of `cmd`, `ctrl`,
   * `alt` (`option`), `shift` joined by `+`: `cmd+s`, `ctrl+shift+t`. `cmd` is the Windows key on
   * Windows. `backspace` deletes backward (the Mac's Delete key) and `delete` forward, on both systems.
   */
  | { type: 'key'; keys: string }
  /** Scrolls at the element's middle or at `x`/`y` (the window's middle with neither) by `dx`/`dy` lines; positive `dy` moves down the page, positive `dx` to the right. */
  | { type: 'scroll'; element?: number; x?: number; y?: number; dx: number; dy: number }
  /** Presses the left button at the first point, moves to the second and lets go. */
  | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number }
  /** Sets what an element holds without typing: a field's text, a slider's or stepper's number. */
  | { type: 'set_value'; element: number; value: string }

interface ControlMethods {
  /**
   * First request after start. `excludePids`: processes whose windows do not exist as far as the
   * helper is concerned (the Pulpo app itself). `imageDir` exists and is the helper's to write
   * snapshots into; the main process deletes them. `maxImageEdge`: no snapshot image is wider or
   * taller, in pixels.
   */
  configure: {
    params: { excludePids: number[]; imageDir: string; maxImageEdge: number }
    /**
     * `background`: actions reach the app without moving the user's pointer, taking the keyboard or
     * bringing the app forward (macOS). False where the app must come to the front and the user's
     * own pointer and keyboard are used (Windows).
     */
    result: { protocol: number; platform: 'macos' | 'windows'; background: boolean }
  }
  /** What the system lets the app do. `prompt` shows the system's own request for whatever is missing (macOS); both are always true on Windows. */
  permissions: { params: { prompt?: boolean }; result: { accessibility: boolean; screenRecording: boolean } }
  /** macOS lists the windows of the Space the user is on, and minimized ones; windows on other Spaces appear once the user goes there. */
  apps: { params: Record<string, never>; result: { apps: ControlApp[] } }
  /**
   * The window as it is now: its picture and, unless `outline` is false, its elements. Element
   * indexes of an earlier snapshot of the same window stop working. A minimized window is restored
   * first, without bringing its app forward where the system allows. On Windows a menu or a dialog
   * the window owns is not a window of its own in `apps`: it is drawn into this picture where it
   * floats and its elements are listed here.
   */
  snapshot: { params: { pid: number; windowId: number; outline?: boolean; maxElements?: number }; result: ControlSnapshot }
  /**
   * Does one thing in the window and shows the agent's own pointer doing it (see `release`). It
   * answers once the input was delivered; the main process waits a moment and takes a snapshot.
   * `note` says in a few words what was done when that is not obvious ("Pressed the Save button").
   */
  act: { params: { pid: number; windowId: number; action: ControlAction }; result: { note?: string } }
  /**
   * The agent's pointer: a pointer of its own drawn over the window it works in, moved (briefly
   * animated) to wherever an action lands, hidden by itself a few seconds after the last one.
   * `release` hides it at once: the reply is over.
   */
  release: { params: Record<string, never>; result: Record<string, never> }
}

export type ControlMethod = keyof ControlMethods
export type ControlParams<M extends ControlMethod> = ControlMethods[M]['params']
export type ControlResult<M extends ControlMethod> = ControlMethods[M]['result']
