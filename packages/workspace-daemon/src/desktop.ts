import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ControlHelper, ControlHelperError } from './control/helper.js'
import type { ControlAction, ControlApp, ControlElement, ControlInputEvent, ControlWindow } from './control/protocol.js'
import { FrameStream, ScreenControl, type FrameStreamOptions } from './desktop-screen.js'

/**
 * The workspace's screen, as the agent's app tools and the chat's owner use it. The image's
 * `pulpo-desktop` brings the screen up and runs the control helper on it; this runs two helpers,
 * one for the agent (`app_list`, `app_act`) and one for what the owner does while in control, so
 * their input never waits behind a picture the agent asked for. It mirrors the desktop app's
 * `AppControl` (apps/desktop/src/computer/control/apps.ts) without approvals: there is no one
 * else's computer here, only the workspace's own screen.
 *
 * The daemon is built on its own into the workspace image, so the few contract values it needs
 * are restated below with where they come from.
 */

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/** From WORKSPACE_SCREEN_WIDTH and WORKSPACE_SCREEN_HEIGHT in packages/contracts/src/workspace-screen.ts. */
export const SCREEN_WIDTH = 1_280
export const SCREEN_HEIGHT = 800
/** From WORKSPACE_SCREEN_INPUT_MAX_EVENTS and WORKSPACE_SCREEN_INPUT_MAX_TEXT in packages/contracts/src/workspace-screen.ts. */
const INPUT_MAX_EVENTS = 64
const INPUT_MAX_TEXT = 2_000
/** From COMPUTER_APP_MAX_ELEMENTS, COMPUTER_APP_IMAGE_MAX_EDGE and COMPUTER_APP_TYPE_MAX_CHARACTERS in packages/contracts/src/computer.ts. */
const MAX_ELEMENTS = 300
const MAX_IMAGE_EDGE = 1_280
const TYPE_MAX_CHARACTERS = 2_000

/** How long after an action the window is looked at again: menus open and pages change a moment later. */
const SETTLE_MS = 400
const SETTLE_TYPING_MS = 150
/** The longest text takes a while to type, and the window is looked at afterwards. */
const HELPER_ACT_TIMEOUT_MS = 40_000
/** A batch of the owner's input may type several long texts. */
const INPUT_TIMEOUT_MS = 60_000
/** Pictures kept on disk: the server fetches the one it was just told about, so only the latest few are needed. */
const KEPT_PICTURES = 4
/** `pulpo-desktop status` is asked at most this often. */
const STATUS_CACHE_MS = 2_000
const STATUS_TIMEOUT_MS = 5_000

export const NO_SCREEN = 'This workspace has no screen: its image does not include the desktop.'
export const HELD = "The user is using the workspace's screen themselves right now, so nothing was done. Wait until they say they are finished; you can still look with app_view."
const CANCELLED = 'The request was cancelled.'
const UNREADABLE = 'The picture of the window could not be read.'

/** The owner's input was refused: not in control, or not input this can carry out. `status` is the HTTP status to answer with. */
export class ScreenInputError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export type AppAction = { type: 'view' } | ControlAction

export interface AppActInput { app: string; window?: string; action: AppAction }

export interface AppElement {
  index: number; depth: number; role: string; label?: string; value?: string
  x: number; y: number; width: number; height: number; focused?: boolean; enabled?: boolean
}

export interface AppState {
  app: string
  window: string
  windows?: string[]
  note?: string
  image: { path: string; mimeType: 'image/jpeg'; width: number; height: number; sizeBytes: number }
  elements: AppElement[]
  truncated: boolean
}

export interface AppList { apps: Array<{ name: string; allowed: true; frontmost: boolean; windows: string[] }> }

export interface DesktopStatus { available: boolean; running: boolean; width: number; height: number; controlled: boolean }

export interface WorkspaceDesktopOptions {
  /** `pulpo-desktop`. */
  command: string
  /** Present when the image has a screen. */
  versionFile: string
  /** The daemon's own folder for the helpers' pictures. */
  imageDir: string
  spawn?: Spawn
  wait?: (milliseconds: number) => Promise<void>
  now?: () => number
  frames?: Omit<FrameStreamOptions, 'command' | 'spawn'>
  log?: (message: string) => void
}

const lower = (value: string) => value.trim().toLowerCase()
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const titles = (app: ControlApp) => app.windows.slice(0, 50).map((window) => String(window.title ?? '').slice(0, 500))

function limited(value: string | undefined, length: number): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

/**
 * The running app the agent means by `query`: its name or its id as written, else the one app whose
 * name starts with it, else the one whose name contains it. Several of those is a question back to
 * the agent, never a guess.
 */
export function findApp(apps: ControlApp[], query: string): ControlApp {
  const wanted = lower(query)
  const names = () => apps.map((app) => app.name).join(', ') || 'none'
  if (!wanted) throw new Error('Name the app to use.')
  const exact = apps.filter((app) => lower(app.name) === wanted || lower(app.id) === wanted)
  const candidates = exact.length ? exact
    : [apps.filter((app) => lower(app.name).startsWith(wanted)), apps.filter((app) => lower(app.name).includes(wanted))].find((found) => found.length) ?? []
  const distinct = new Set(candidates.map((app) => app.id))
  if (!candidates.length) throw new Error(`No app named "${query}" is running with a window open on the workspace's screen. Running apps: ${names()}. Start it with a shell command first (\`chromium <url>\` opens a page in the browser).`)
  if (distinct.size > 1) throw new Error(`"${query}" could be ${candidates.map((app) => app.name).join(' or ')}. Name one of them exactly.`)
  return candidates[0]!
}

/** The window whose title contains `query`, or the front one when none is asked for. */
export function findWindow(app: ControlApp, query: string | undefined): ControlWindow {
  const all = () => app.windows.map((window) => JSON.stringify(window.title)).join(', ')
  if (!app.windows.length) throw new Error(`${app.name} has no window open.`)
  if (!query?.trim()) return app.windows[0]!
  const wanted = lower(query)
  const exact = app.windows.filter((window) => lower(window.title) === wanted)
  const found = exact.length ? exact : app.windows.filter((window) => lower(window.title).includes(wanted))
  if (!found.length) throw new Error(`${app.name} has no window titled like "${query}". Its windows: ${all()}.`)
  return found[0]!
}

/** Actions that mean something only in the picture the agent was shown. */
function needsPicture(action: AppAction): boolean {
  if (action.type === 'click' || action.type === 'drag' || action.type === 'set_value') return true
  return action.type === 'scroll' && (action.element !== undefined || action.x !== undefined || action.y !== undefined)
}

/** A helper's element as the contract carries it: nothing it does not know, numbers that are numbers. */
function element(raw: ControlElement): AppElement | null {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  const index = number(raw.index); const x = number(raw.x); const y = number(raw.y); const width = number(raw.width); const height = number(raw.height)
  if (index === null || index < 1 || x === null || y === null || width === null || height === null || width < 0 || height < 0) return null
  const label = limited(raw.label, 200); const value = limited(raw.value, 200)
  return {
    index, depth: Math.min(Math.max(number(raw.depth) ?? 0, 0), 100), role: String(raw.role || 'element').slice(0, 40), x, y, width, height,
    ...(label ? { label } : {}), ...(value ? { value } : {}), ...(raw.focused === true ? { focused: true } : {}), ...(raw.enabled === false ? { enabled: false } : {}),
  }
}

// The server validates both inputs before they get here; they are checked again because the daemon
// takes nothing on trust, with the server's defaults applied where a field may be left out.

function invalid(message: string): never { throw new Error(`Invalid app action: ${message}.`) }

function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(`${name} must be a number from ${min} to ${max}`)
  return value
}
function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined { return value === undefined ? undefined : read(value) }
function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) invalid(`${name} must be text of ${min} to ${max} characters`)
  return value
}
function choice<T extends string | number>(value: unknown, name: string, choices: readonly T[], fallback: T): T {
  if (value === undefined) return fallback
  if (!choices.includes(value as T)) invalid(`${name} must be one of ${choices.join(', ')}`)
  return value as T
}

const BUTTONS = ['left', 'right', 'middle'] as const
const COUNTS = [1, 2, 3] as const
const coordinate = (value: unknown, name: string) => number(value, name, 0, 100_000)
const elementIndex = (value: unknown) => number(value, 'element', 1, 100_000, true)

export function parseAction(value: unknown): AppAction {
  if (!isRecord(value)) invalid('it is missing')
  switch (value.type) {
    case 'view': return { type: 'view' }
    case 'click': {
      const element = optional(value.element, elementIndex); const x = optional(value.x, (one) => coordinate(one, 'x')); const y = optional(value.y, (one) => coordinate(one, 'y'))
      if (element === undefined && (x === undefined || y === undefined)) invalid('name an element or give both x and y')
      return { type: 'click', element, x, y, button: choice(value.button, 'button', BUTTONS, 'left'), count: choice(value.count, 'count', COUNTS, 1) }
    }
    case 'type': return { type: 'type', text: text(value.text, 'text', 1, TYPE_MAX_CHARACTERS) }
    case 'key': return { type: 'key', keys: text(value.keys, 'keys', 1, 100) }
    case 'scroll': {
      const element = optional(value.element, elementIndex); const x = optional(value.x, (one) => coordinate(one, 'x')); const y = optional(value.y, (one) => coordinate(one, 'y'))
      const dx = optional(value.dx, (one) => number(one, 'dx', -100, 100, true)) ?? 0; const dy = optional(value.dy, (one) => number(one, 'dy', -100, 100, true)) ?? 0
      if (!dx && !dy) invalid('scroll by at least one line')
      return { type: 'scroll', element, x, y, dx, dy }
    }
    case 'drag': return { type: 'drag', fromX: coordinate(value.fromX, 'fromX'), fromY: coordinate(value.fromY, 'fromY'), toX: coordinate(value.toX, 'toX'), toY: coordinate(value.toY, 'toY') }
    case 'set_value': return { type: 'set_value', element: elementIndex(value.element), value: text(value.value, 'value', 0, 10_000) }
    default: invalid(`unknown type ${JSON.stringify(value.type)}`)
  }
}

export function parseActInput(args: Record<string, unknown>): AppActInput {
  const app = text(args.app, 'app', 1, 200)
  const window = args.window === undefined ? undefined : text(args.window, 'window', 1, 500)
  return { app, ...(window === undefined ? {} : { window }), action: parseAction(args.action) }
}

/** The owner's events, in the protocol's words, or a 400 naming what is wrong. Never says what was typed. */
export function parseInputEvents(value: unknown): ControlInputEvent[] {
  const bad = (message: string): never => { throw new ScreenInputError(400, `Invalid input: ${message}.`) }
  if (!isRecord(value) || !Array.isArray(value.events) || !value.events.length || value.events.length > INPUT_MAX_EVENTS) bad(`send 1 to ${INPUT_MAX_EVENTS} events`)
  const events = (value as { events: unknown[] }).events
  return events.map((event, position): ControlInputEvent => {
    const at = `event ${position + 1}`
    if (!isRecord(event)) return bad(`${at} is not an object`)
    const point = (name: 'x' | 'y', max: number) => {
      const one = event[name]
      if (typeof one !== 'number' || !Number.isFinite(one) || one < 0 || one > max) bad(`${at} needs ${name} from 0 to ${max}`)
      return one as number
    }
    const button = () => {
      const one = event.button ?? 'left'
      if (!BUTTONS.includes(one as never)) bad(`${at} has an unknown button`)
      return one as 'left' | 'middle' | 'right'
    }
    const notches = (name: 'dx' | 'dy') => {
      const one = event[name] ?? 0
      if (typeof one !== 'number' || !Number.isInteger(one) || one < -20 || one > 20) bad(`${at} needs ${name} from -20 to 20`)
      return one as number
    }
    switch (event.type) {
      case 'move': return { type: 'move', x: point('x', SCREEN_WIDTH), y: point('y', SCREEN_HEIGHT) }
      case 'down': case 'up': return { type: event.type, x: point('x', SCREEN_WIDTH), y: point('y', SCREEN_HEIGHT), button: button() }
      case 'click': {
        const count = event.count ?? 1
        if (!COUNTS.includes(count as never)) bad(`${at} needs a count of 1, 2 or 3`)
        return { type: 'click', x: point('x', SCREEN_WIDTH), y: point('y', SCREEN_HEIGHT), button: button(), count: count as 1 | 2 | 3 }
      }
      case 'scroll': {
        const dx = notches('dx'); const dy = notches('dy')
        if (!dx && !dy) bad(`${at} scrolls by nothing`)
        return { type: 'scroll', x: point('x', SCREEN_WIDTH), y: point('y', SCREEN_HEIGHT), dx, dy }
      }
      case 'text':
        if (typeof event.text !== 'string' || !event.text.length || event.text.length > INPUT_MAX_TEXT) bad(`${at} needs text of 1 to ${INPUT_MAX_TEXT} characters`)
        return { type: 'text', text: event.text as string }
      case 'key':
        if (typeof event.keys !== 'string' || !event.keys.length || event.keys.length > 100) bad(`${at} needs keys of 1 to 100 characters`)
        return { type: 'key', keys: event.keys as string }
      default: return bad(`${at} has an unknown type`)
    }
  })
}

export class WorkspaceDesktop {
  readonly control: ScreenControl
  readonly frames: FrameStream
  /** The agent's helper: apps, pictures and actions. */
  private readonly agent: ControlHelper
  /** The owner's helper: only their input. */
  private readonly user: ControlHelper
  /**
   * Per app id, the window the agent was last shown: the only one its clicks can mean. There is one
   * workspace per daemon and one agent working on it, so one map does.
   */
  private readonly shown = new Map<string, number>()
  /** Pictures on disk, oldest first. */
  private pictures: string[] = []
  /** App operations run one at a time, so the elements an action names are the ones its picture showed. */
  private turn: Promise<void> = Promise.resolve()
  private status_: { at: number; running: Promise<boolean> } | null = null
  private emptied = false
  private readonly spawn: Spawn
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly now: () => number

  constructor(private readonly options: WorkspaceDesktopOptions) {
    this.spawn = options.spawn ?? nodeSpawn
    this.wait = options.wait ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)))
    this.now = options.now ?? Date.now
    this.control = new ScreenControl(undefined, this.now)
    const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`))
    const helper = (onError: (message: string, error: unknown) => void) => new ControlHelper({
      command: { file: options.command, args: ['helper'] }, excludePids: [], imageDir: options.imageDir, maxImageEdge: MAX_IMAGE_EDGE,
      prepare: () => this.prepare(), spawn: this.spawn, onError,
    })
    this.agent = helper((message, error) => log(`pulpo desktop: ${message}: ${error instanceof Error ? error.message : String(error)}`))
    // Whatever this helper said on its way out may echo what the owner typed, so it is not logged.
    this.user = helper((message) => log(`pulpo desktop input: ${message}`))
    this.frames = new FrameStream({ ...options.frames, command: options.command, spawn: this.spawn, onError: options.frames?.onError ?? ((message) => log(`pulpo desktop: ${message}`)) })
  }

  /** Makes the pictures folder, empty of anything an earlier run of the daemon left there. */
  private async prepare(): Promise<void> {
    await mkdir(this.options.imageDir, { recursive: true, mode: 0o700 })
    if (this.emptied) return
    this.emptied = true
    for (const name of await readdir(this.options.imageDir).catch(() => [])) await rm(join(this.options.imageDir, name), { force: true }).catch(() => undefined)
  }

  async available(): Promise<boolean> {
    try { await access(this.options.versionFile); return true } catch { return false }
  }

  private async requireScreen(): Promise<void> {
    if (!await this.available()) throw new Error(NO_SCREEN)
  }

  /** Never starts anything: whether the screen is up is asked of `pulpo-desktop status`, at most every couple of seconds. */
  async status(): Promise<DesktopStatus> {
    const available = await this.available()
    return { available, running: available && await this.sessionRunning(), width: SCREEN_WIDTH, height: SCREEN_HEIGHT, controlled: this.control.held }
  }

  private sessionRunning(): Promise<boolean> {
    if (this.status_ && this.now() - this.status_.at < STATUS_CACHE_MS) return this.status_.running
    const running = new Promise<boolean>((done) => {
      let child: ChildProcess
      try { child = this.spawn(this.options.command, ['status'], { stdio: 'ignore' }) } catch { return done(false) }
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } done(false) }, STATUS_TIMEOUT_MS)
      child.once('error', () => { clearTimeout(timer); done(false) })
      child.once('exit', (code) => { clearTimeout(timer); done(code === 0) })
    })
    this.status_ = { at: this.now(), running }
    return running
  }

  /** Runs `work` once the app operations before it are done; a cancelled one stops waiting at once. */
  private async exclusive<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const before = this.turn
    let done!: () => void
    this.turn = before.then(() => new Promise<void>((resolve) => { done = resolve }))
    try {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error(CANCELLED))
        const abort = () => reject(new Error(CANCELLED))
        signal.addEventListener('abort', abort, { once: true })
        void before.then(() => { signal.removeEventListener('abort', abort); resolve() })
      })
      return await work()
    } finally {
      // `done` is set once `before` settles; a request that stopped waiting earlier lets the next one go as soon as `before` does.
      void before.then(() => done())
    }
  }

  /**
   * Asks the agent's helper one thing. Cancelling while the helper works on it stops the helper (a
   * long text being typed ends with it); the next request starts another. `stillWanted` is asked
   * when the request's turn comes. Helper failures come back as the agent reads them.
   */
  private async ask<T>(signal: AbortSignal, request: (stillWanted: () => boolean) => Promise<T>, allowed: () => boolean = () => true): Promise<T> {
    let sent = false
    let held = false
    const stop = () => { if (sent) this.agent.stop() }
    signal.addEventListener('abort', stop, { once: true })
    try {
      return await request(() => {
        if (signal.aborted) return false
        // The owner took the screen while this waited its turn.
        if (!allowed()) { held = true; return false }
        sent = true
        return true
      })
    } catch (error) {
      if (signal.aborted) throw new Error(CANCELLED, { cause: error })
      if (held) throw new Error(HELD, { cause: error })
      if (!(error instanceof ControlHelperError)) throw error
      const hint = error.code === 'stale_element' ? ' Element numbers are those of the last result for this window; look at it again.' : ''
      throw new Error(`${error.message}${hint}`, { cause: error })
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }

  private async running(signal: AbortSignal): Promise<ControlApp[]> {
    const { apps } = await this.ask(signal, (stillWanted) => this.agent.call('apps', {}, { stillWanted }))
    return (Array.isArray(apps) ? apps : []).filter((app) => app && typeof app.id === 'string' && typeof app.name === 'string' && Array.isArray(app.windows))
  }

  async list(signal: AbortSignal): Promise<{ output: string; result: AppList }> {
    await this.requireScreen()
    return this.exclusive(signal, async () => {
      const apps = (await this.running(signal)).slice(0, 200).map((app) => ({ name: app.name.slice(0, 200), allowed: true as const, frontmost: app.frontmost === true, windows: titles(app) }))
      const output = apps.length
        ? `Apps with a window open on the workspace's screen: ${apps.map((app) => app.windows.length > 1 ? `${app.name} (${app.windows.length} windows)` : app.name).join(', ')}.`
        : "No app has a window open on the workspace's screen."
      return { output, result: { apps } }
    })
  }

  /** Keeps the picture for the server to fetch, and lets go of the ones before the last few. */
  private async picture(image: { path?: unknown; width?: unknown; height?: unknown } | undefined): Promise<AppState['image']> {
    const file = resolve(String(image?.path ?? ''))
    // The helper writes only into its own folder; anything else is not a picture it took.
    if (dirname(file) !== resolve(this.options.imageDir)) throw new Error(UNREADABLE)
    const metadata = await stat(file).catch(() => null)
    if (!metadata?.isFile() || !metadata.size) throw new Error(UNREADABLE)
    this.pictures = [...this.pictures.filter((kept) => kept !== file), file]
    for (const old of this.pictures.splice(0, Math.max(0, this.pictures.length - KEPT_PICTURES))) await rm(old, { force: true }).catch(() => undefined)
    const size = (value: unknown) => Math.max(1, Math.round(typeof value === 'number' && Number.isFinite(value) ? value : 1))
    return { path: file, mimeType: 'image/jpeg', width: size(image?.width), height: size(image?.height), sizeBytes: metadata.size }
  }

  async act(args: Record<string, unknown>, signal: AbortSignal): Promise<{ output: string; result: AppState }> {
    const input = parseActInput(args)
    await this.requireScreen()
    const { action } = input
    const free = () => action.type === 'view' || !this.control.held
    if (!free()) throw new Error(HELD)
    return this.exclusive(signal, async () => {
      if (!free()) throw new Error(HELD)
      const app = findApp(await this.running(signal), input.app)
      const appKey = lower(app.id)
      const sameApp = (candidate: ControlApp) => candidate.pid === app.pid && candidate.id === app.id
      let window: ControlWindow
      if (action.type === 'view') window = findWindow(app, input.window)
      else {
        const shown = this.shown.get(appKey)
        window = input.window ? findWindow(app, input.window) : app.windows.find((candidate) => candidate.id === shown) ?? findWindow(app, undefined)
        if (needsPicture(action) && window.id !== shown) {
          throw new Error(`Look at ${app.name}'s window ${JSON.stringify(window.title)} first: element numbers and coordinates are those of the last picture of a window, and this one was not shown to you yet, has closed since, or the user has used the screen since.`)
        }
      }
      let note: string | undefined
      let after = app
      if (action.type !== 'view') {
        const done = await this.ask(signal, (stillWanted) => this.agent.call('act', { pid: app.pid, windowId: window.id, action }, { timeoutMs: HELPER_ACT_TIMEOUT_MS, stillWanted }), free)
        note = limited(typeof done?.note === 'string' ? done.note : undefined, 800)
        await this.wait(action.type === 'type' ? SETTLE_TYPING_MS : SETTLE_MS)
        if (signal.aborted) throw new Error(CANCELLED)
        const now = (await this.running(signal)).find(sameApp)
        if (!now?.windows.length) {
          this.shown.delete(appKey)
          throw new Error(`${note ?? 'That was done'}, and ${app.name} has no window open any more.`)
        }
        after = now
        // A window that was not there before and is now in front is what the action opened (a dialog): that is what there is to see.
        const front = now.windows[0]!
        const opened = !app.windows.some((candidate) => candidate.id === front.id)
        const next = opened ? front : now.windows.find((candidate) => candidate.id === window.id) ?? front
        if (next.id !== window.id) note = [note, opened ? `A window opened: ${JSON.stringify(next.title)}.` : `That window closed; this is ${JSON.stringify(next.title)}.`].filter(Boolean).join(' ')
        window = next
      }
      const snapshot = await this.ask(signal, (stillWanted) => this.agent.call('snapshot', { pid: app.pid, windowId: window.id, maxElements: MAX_ELEMENTS }, { stillWanted }))
      if (signal.aborted) {
        await rm(resolve(String(snapshot?.image?.path ?? '')), { force: true }).catch(() => undefined)
        throw new Error(CANCELLED)
      }
      const image = await this.picture(snapshot?.image)
      this.shown.set(appKey, window.id)
      const elements = (Array.isArray(snapshot.elements) ? snapshot.elements : []).flatMap((raw) => { const one = element(raw); return one ? [one] : [] }).slice(0, 1_000)
      const result: AppState = {
        app: app.name.slice(0, 200),
        window: String(snapshot.window?.title ?? window.title ?? '').slice(0, 500),
        windows: titles(after),
        ...(note ? { note } : {}),
        image,
        elements,
        truncated: snapshot.truncated === true,
      }
      const output = `${note ? `${note} ` : ''}Showed ${result.app}'s window ${JSON.stringify(result.window)} with ${elements.length} element${elements.length === 1 ? '' : 's'}${result.truncated ? ' (more not listed)' : ''}.`
      return { output, result }
    })
  }

  /** Takes control for the owner, renews it, or gives it back. */
  setControl(held: boolean): boolean {
    if (held) this.control.take()
    else this.control.release()
    return this.control.held
  }

  /**
   * Carries out what the owner did, in order, on their own helper. Renews control. The agent's
   * pictures are out of date afterwards, so it must look again before it clicks.
   */
  async input(value: unknown): Promise<void> {
    const events = parseInputEvents(value)
    if (!this.control.held) throw new ScreenInputError(409, 'not_controlled')
    this.control.take()
    this.shown.clear()
    try { await this.user.call('input', { events }, { timeoutMs: INPUT_TIMEOUT_MS }) } catch (error) {
      throw new ScreenInputError(502, error instanceof Error ? error.message : String(error))
    } finally {
      if (this.control.held) this.control.take()
    }
  }

  shutdown(): void {
    this.agent.stop()
    this.user.stop()
    this.frames.stop()
  }
}
