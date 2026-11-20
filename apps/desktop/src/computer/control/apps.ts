import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  COMPUTER_APP_ACT_TIMEOUT_MS, COMPUTER_APP_APPROVAL_TIMEOUT_MS, COMPUTER_APP_MAX_ELEMENTS, COMPUTER_INLINE_MAX_BYTES,
  type ComputerAllowedApp, type ComputerApp, type ComputerAppAction, type ComputerAppState,
} from '@pulpo/contracts'
import { ComputerError } from '../errors'
import { ControlHelperError, type ControlHelper } from './helper'
import type { ControlAction, ControlApp, ControlElement, ControlWindow } from './protocol'

/**
 * Seeing and working in other apps' windows, for a full-access session. This is where it is decided
 * what the agent may touch: an app is used only after the user allowed that app in a native dialog,
 * the Pulpo app itself and the system's own security prompts never are, and the agent is shown one
 * allowed app's window at a time, never the screen. The helper (helper.ts) only does what it is asked.
 */

/** The agent's input needs no pointer or keyboard of the user's on macOS; Windows shares theirs. */
export function appControlCapability(platform: NodeJS.Platform): { version: number; background: boolean } | null {
  if (platform === 'darwin') return { version: 1, background: true }
  if (platform === 'win32') return { version: 1, background: false }
  return null
}

/**
 * Apps the agent is never shown and never asked about. The Pulpo app is where the user answers the
 * agent's questions, so an agent that could click there could answer them itself; the rest are the
 * system's sign-in, permission and credential prompts.
 */
const NEVER_ALLOWED = new Set([
  'com.isaacthoman.pulpo.desktop', 'pulpo.exe',
  'com.apple.loginwindow', 'com.apple.securityagent', 'com.apple.usernotificationcenter', 'com.apple.coreservices.uiagent',
  'com.apple.localauthentication.ui', 'com.apple.authenticationservices.helper', 'com.apple.screensaver.engine',
  'consent.exe', 'logonui.exe', 'lockapp.exe', 'credentialuibroker.exe', 'winlogon.exe',
])

export function appNeverAllowed(id: string): boolean { return NEVER_ALLOWED.has(id.toLowerCase()) }

/** How long after an action the window is looked at again: menus open and pages change a moment later. */
const SETTLE_MS = 400
const SETTLE_TYPING_MS = 150
/** The helper's share of `COMPUTER_APP_ACT_TIMEOUT_MS`: the longest text takes Windows half a minute to type, and the window is looked at afterwards. */
const HELPER_ACT_TIMEOUT_MS = 40_000
/** However little time the server left, the user gets this long to answer. */
const MIN_APPROVAL_MS = 5_000

const lower = (value: string) => value.trim().toLowerCase()
/** `Notepad.exe` and `TextEdit.app` are how a model may write a name the user knows as Notepad and TextEdit. */
const bare = (value: string) => lower(value).replace(/\.(app|exe)$/, '')

/**
 * The running app the agent means by `query`: its name or its id as written, else the one app whose
 * name starts with it, else the one whose name contains it. Several of those is a question back to
 * the agent, never a guess.
 */
export function findApp(apps: ControlApp[], query: string): ControlApp {
  const wanted = bare(query)
  const names = () => apps.map((app) => app.name).join(', ') || 'none'
  if (!wanted) throw new ComputerError('invalid_request', 'Name the app to use.')
  const exact = apps.filter((app) => bare(app.name) === wanted || lower(app.id) === lower(query) || bare(app.id) === wanted)
  const candidates = exact.length ? exact
    : [apps.filter((app) => bare(app.name).startsWith(wanted)), apps.filter((app) => bare(app.name).includes(wanted))].find((found) => found.length) ?? []
  // The same app may run twice (two instances of one program); the first is the one in front.
  const distinct = new Set(candidates.map((app) => app.id))
  if (!candidates.length) throw new ComputerError('not_found', `No app named "${query}" is running with a window open. Running apps: ${names()}. Start it with a shell command first if the user wants it used.`)
  if (distinct.size > 1) throw new ComputerError('invalid_request', `"${query}" could be ${candidates.map((app) => app.name).join(' or ')}. Name one of them exactly.`)
  return candidates[0]!
}

/** The window whose title contains `query`, or the front one when none is asked for. */
export function findWindow(app: ControlApp, query: string | undefined): ControlWindow {
  const titles = () => app.windows.map((window) => JSON.stringify(window.title)).join(', ')
  if (!app.windows.length) throw new ComputerError('not_found', `${app.name} has no window open.`)
  if (!query?.trim()) return app.windows[0]!
  const wanted = lower(query)
  const exact = app.windows.filter((window) => lower(window.title) === wanted)
  const found = exact.length ? exact : app.windows.filter((window) => lower(window.title).includes(wanted))
  if (!found.length) throw new ComputerError('not_found', `${app.name} has no window titled like "${query}". Its windows: ${titles()}.`)
  return found[0]!
}

const grantKey = (account: string, appId: string) => `${account}\0${lower(appId)}`
const windowKey = (app: ControlApp, window: ControlWindow) => `${app.pid}:${window.id}`
const titles = (app: ControlApp) => app.windows.slice(0, 50).map((window) => String(window.title ?? '').slice(0, 500))

function limited(value: string | undefined, length: number): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

/** A helper's element as the contract carries it: nothing it does not know, numbers that are numbers. */
function element(raw: ControlElement): ComputerAppState['elements'][number] | null {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  const index = number(raw.index); const x = number(raw.x); const y = number(raw.y); const width = number(raw.width); const height = number(raw.height)
  if (index === null || index < 1 || x === null || y === null || width === null || height === null || width < 0 || height < 0) return null
  const label = limited(raw.label, 200); const value = limited(raw.value, 200)
  return {
    index, depth: Math.min(Math.max(number(raw.depth) ?? 0, 0), 100), role: String(raw.role || 'element').slice(0, 40), x, y, width, height,
    ...(label ? { label } : {}), ...(value ? { value } : {}), ...(raw.focused === true ? { focused: true } : {}), ...(raw.enabled === false ? { enabled: false } : {}),
  }
}

export interface AppControlOptions {
  helper: Pick<ControlHelper, 'call' | 'stop' | 'started'>
  platform: NodeJS.Platform
  /** Where the helper writes its pictures. */
  imageDir: string
  /** The native question about one app; true when the user chose Allow. Ends, as a refusal, when `signal` aborts. */
  confirmApp: (message: string, detail: string, signal: AbortSignal) => Promise<boolean>
  wait?: (milliseconds: number) => Promise<void>
}

export interface AppControlSession {
  sessionId: string
  /** Who the session belongs to; approvals are theirs alone. */
  account: string
  /** The apps that account allowed, and remembering one more. */
  allowedApps: () => Promise<ComputerAllowedApp[]>
  allowApp: (app: ComputerAllowedApp) => Promise<void>
  /** Asked again just before anything is done: the reply may have ended, or its access been taken back, meanwhile. */
  active: () => boolean
}

interface SessionState {
  /** Apps the user refused during this reply; it is not asked about them again. */
  refused: Set<string>
  /** Per app, the window the agent was last shown: the only one its clicks can mean. */
  shown: Map<string, number>
  /** Pictures too large to send inline, kept until the server has fetched them. */
  images: string[]
}

/** A question put to the user, and the replies waiting for its answer. */
interface Question { answer: Promise<boolean>; cancel: AbortController; sessions: Set<string> }

/** Actions that mean something only in the picture the agent was shown. */
function needsPicture(action: ComputerAppAction): boolean {
  if (action.type === 'click' || action.type === 'drag' || action.type === 'set_value') return true
  return action.type === 'scroll' && (action.element !== undefined || action.x !== undefined || action.y !== undefined)
}

export class AppControl {
  private readonly sessions = new Map<string, SessionState>()
  /** One question per app at a time, however many requests want it answered. */
  private readonly questions = new Map<string, Question>()
  /** Replies with an action being carried out by the helper right now: how many, and in which app of whose. */
  private readonly acting = new Map<string, { count: number; grant: string }>()
  /** How often each account's use of each app was taken back, so work begun under an approval can tell it is gone. */
  private readonly takenBack = new Map<string, number>()
  /**
   * Per window, the reply that last had it pictured. The helper keeps one list of elements per
   * window, the latest; a number means what a reply saw only while that list is its own.
   */
  private readonly picturedFor = new Map<string, string>()
  private readonly wait: (milliseconds: number) => Promise<void>
  private permissionsRequested = false

  constructor(private readonly options: AppControlOptions) {
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  private state(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) { state = { refused: new Set(), shown: new Map(), images: [] }; this.sessions.set(sessionId, state) }
    return state
  }

  /** Helper failures as the agent reads them. */
  private async ask<T>(request: () => Promise<T>): Promise<T> {
    try { return await request() } catch (error) {
      if (!(error instanceof ControlHelperError)) throw error
      if (error.code === 'permission_denied') throw await this.permissionMissing(error.message)
      const code = error.code === 'not_found' ? 'not_found' : error.code === 'invalid_request' || error.code === 'stale_element' ? 'invalid_request' : 'failed'
      const hint = error.code === 'stale_element' ? ' Element numbers are those of the last result for this window; look at it again.' : ''
      throw new ComputerError(code, `${error.message}${hint}`)
    }
  }

  /**
   * macOS has not let Pulpo see or control other apps. The system's own request is shown once per
   * run of the app; the helper is stopped so the next one starts with whatever the user allowed.
   */
  private async permissionMissing(detail: string): Promise<ComputerError> {
    if (!this.permissionsRequested) {
      this.permissionsRequested = true
      await this.options.helper.call('permissions', { prompt: true }).catch(() => undefined)
    }
    this.options.helper.stop()
    return new ComputerError('not_allowed', `macOS has not allowed Pulpo to do this yet (${detail.replace(/\.$/, '')}). The user must turn Pulpo on under System Settings > Privacy & Security > Accessibility and > Screen & System Audio Recording, then ask again. Tell them so; do not retry until they say it is done.`)
  }

  private async running(): Promise<ControlApp[]> {
    const { apps } = await this.ask(() => this.options.helper.call('apps', {}))
    return (Array.isArray(apps) ? apps : []).filter((app) => app && typeof app.id === 'string' && typeof app.name === 'string' && !appNeverAllowed(app.id) && Array.isArray(app.windows))
  }

  async list(session: AppControlSession): Promise<{ apps: ComputerApp[] }> {
    const [apps, allowed] = await Promise.all([this.running(), session.allowedApps()])
    const allowedIds = new Set(allowed.map((app) => lower(app.id)))
    return {
      apps: apps.slice(0, 200).map((app) => {
        const isAllowed = allowedIds.has(lower(app.id))
        return {
          name: app.name.slice(0, 200), allowed: isAllowed, frontmost: app.frontmost === true,
          // A title can name a document or a page; the agent learns it once the user lets it use the app.
          windows: isAllowed ? titles(app) : [],
        }
      }),
    }
  }

  /** Whether the agent may use the app, asking the user when they have not said yet. */
  private async approved(session: AppControlSession, app: ControlApp, patienceMs: number): Promise<boolean> {
    const id = lower(app.id)
    if ((await session.allowedApps()).some((allowed) => lower(allowed.id) === id)) return true
    const state = this.state(session.sessionId)
    if (state.refused.has(id)) return false
    const key = `${session.account}\0${id}`
    let question = this.questions.get(key)
    if (!question) {
      const background = appControlCapability(this.options.platform)?.background === true
      const cancel = new AbortController()
      const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(Math.max(MIN_APPROVAL_MS, Math.min(COMPUTER_APP_APPROVAL_TIMEOUT_MS, patienceMs)))])
      const answer = this.options.confirmApp(
        `Let Pulpo Agent use ${app.name}?`,
        `The agent will be able to see ${app.name}'s windows and click and type in them, in this chat and later ones. ${background
          ? 'It works in the background with a pointer of its own; yours stays where it is.'
          : 'While it works, it brings the app to the front and uses your pointer and keyboard.'} You can take this back in Settings.`,
        signal,
      ).then((allowed) => allowed === true && !signal.aborted, () => false).finally(() => { this.questions.delete(key) })
      question = { answer, cancel, sessions: new Set() }
      this.questions.set(key, question)
    }
    question.sessions.add(session.sessionId)
    const allowed = await question.answer
    // The reply may be over, or the access taken back, since the question was put: nothing is remembered then.
    if (!session.active()) return false
    if (!allowed) { state.refused.add(id); return false }
    await session.allowApp({ id: app.id, name: app.name })
    return true
  }

  /** Reads the helper's picture: inline when small, else left where it is for the server to fetch. */
  private async image(state: SessionState, image: { path: string; width: number; height: number }): Promise<ComputerAppState['image']> {
    // The server has fetched the previous ones by the time it asks for the next.
    for (const old of state.images.splice(0)) await rm(old, { force: true }).catch(() => undefined)
    const file = path.resolve(String(image?.path ?? ''))
    const same = (left: string, right: string) => this.options.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
    // The helper writes only into its own folder; anything else is not a picture it took.
    if (!same(path.dirname(file), path.resolve(this.options.imageDir))) throw new ComputerError('failed', 'The picture of the window could not be read.')
    const data = await readFile(file).catch(() => null)
    if (!data?.byteLength) throw new ComputerError('failed', 'The picture of the window could not be read.')
    const described = { mimeType: 'image/jpeg' as const, width: Math.max(1, Math.round(image.width)), height: Math.max(1, Math.round(image.height)), sizeBytes: data.byteLength }
    if (data.byteLength <= COMPUTER_INLINE_MAX_BYTES) {
      await rm(file, { force: true }).catch(() => undefined)
      return { ...described, data: data.toString('base64') }
    }
    state.images.push(file)
    return { ...described, path: file }
  }

  /**
   * `timeoutMs` is how long the server waits for the answer. What is left of it after the time an
   * action may take is the user's to answer the question about an app they have not allowed yet.
   */
  async act(session: AppControlSession, input: { app: string; window?: string; action: ComputerAppAction }, timeoutMs: number): Promise<ComputerAppState> {
    const gone = () => new ComputerError('unknown_session', 'The reply this belongs to is over, or the user took this access back. Nothing more was done.')
    const app = findApp(await this.running(), input.app)
    if (!await this.approved(session, app, timeoutMs - COMPUTER_APP_ACT_TIMEOUT_MS - MIN_APPROVAL_MS)) {
      if (!session.active()) throw gone()
      throw new ComputerError('not_allowed', `The user has not allowed Pulpo Agent to use ${app.name}. Do not try again in this reply unless they ask; say what you wanted to do there and let them decide.`)
    }
    const state = this.state(session.sessionId)
    const appKey = lower(app.id)
    const { action } = input
    // The approval this request runs under. Taken back while the request waits or runs, it no
    // longer covers it: Remove in Settings stops what the agent is doing in that app.
    const grant = grantKey(session.account, app.id)
    const approvals = this.takenBack.get(grant) ?? 0
    const allowedStill = () => (this.takenBack.get(grant) ?? 0) === approvals
    const takenBack = () => new ComputerError('not_allowed', `The user took back Pulpo Agent's use of ${app.name} while this was under way. Do not try again in this reply unless they ask.`)
    let window: ControlWindow
    if (action.type === 'view') window = findWindow(app, input.window)
    else {
      const shown = state.shown.get(appKey)
      window = input.window ? findWindow(app, input.window) : app.windows.find((candidate) => candidate.id === shown) ?? findWindow(app, undefined)
      if (needsPicture(action) && (window.id !== shown || this.picturedFor.get(windowKey(app, window)) !== session.sessionId)) {
        throw new ComputerError('invalid_request', `Look at ${app.name}'s window ${JSON.stringify(window.title)} first: element numbers and coordinates are those of the last picture of a window, and this one was not shown to you yet, has closed since, or was pictured for another reply meanwhile.`)
      }
    }
    let note: string | undefined
    let after = app
    if (action.type !== 'view') {
      if (!session.active()) throw gone()
      // Counted while the helper works, so a reply that ends meanwhile, or an app taken back, can have the action stopped.
      this.acting.set(session.sessionId, { count: (this.acting.get(session.sessionId)?.count ?? 0) + 1, grant })
      let done
      try {
        // The request may wait behind another reply's; by its turn this reply may be over or the app taken back.
        done = await this.ask(() => this.options.helper.call('act', { pid: app.pid, windowId: window.id, action: action as ControlAction }, {
          timeoutMs: HELPER_ACT_TIMEOUT_MS, stillWanted: () => session.active() && allowedStill(),
        }))
      } catch (error) {
        if (!session.active()) throw gone()
        if (!allowedStill()) throw takenBack()
        throw error
      } finally {
        const left = (this.acting.get(session.sessionId)?.count ?? 1) - 1
        if (left > 0) this.acting.set(session.sessionId, { count: left, grant })
        else this.acting.delete(session.sessionId)
      }
      if (!allowedStill()) throw takenBack()
      note = limited(typeof done?.note === 'string' ? done.note : undefined, 800)
      await this.wait(action.type === 'type' ? SETTLE_TYPING_MS : SETTLE_MS)
      const now = (await this.running()).find((candidate) => candidate.pid === app.pid)
      if (!now?.windows.length) {
        state.shown.delete(appKey)
        throw new ComputerError('not_found', `${note ?? 'That was done'}, and ${app.name} has no window open any more.`)
      }
      after = now
      // A window that was not there before and is now in front is what the action opened (a dialog): that is what there is to see.
      const front = now.windows[0]!
      const opened = !app.windows.some((candidate) => candidate.id === front.id)
      const next = opened ? front : now.windows.find((candidate) => candidate.id === window.id) ?? front
      if (next.id !== window.id) note = [note, opened ? `A window opened: ${JSON.stringify(next.title)}.` : `That window closed; this is ${JSON.stringify(next.title)}.`].filter(Boolean).join(' ')
      window = next
    }
    const snapshot = await this.ask(() => this.options.helper.call('snapshot', { pid: app.pid, windowId: window.id, maxElements: COMPUTER_APP_MAX_ELEMENTS }))
    if (!session.active()) throw gone()
    // Its picture is not handed over either.
    if (!allowedStill()) {
      await rm(path.resolve(String(snapshot.image?.path ?? '')), { force: true }).catch(() => undefined)
      throw takenBack()
    }
    state.shown.set(appKey, window.id)
    this.picturedFor.set(windowKey(app, window), session.sessionId)
    const elements = (Array.isArray(snapshot.elements) ? snapshot.elements : []).flatMap((raw) => { const one = element(raw); return one ? [one] : [] }).slice(0, 1_000)
    return {
      app: app.name.slice(0, 200),
      window: String(snapshot.window?.title ?? window.title ?? '').slice(0, 500),
      windows: titles(after),
      ...(note ? { note } : {}),
      image: await this.image(state, snapshot.image),
      elements,
      truncated: snapshot.truncated === true,
    }
  }

  /**
   * The reply is over, or its access was taken back: its pictures go, a question only it was
   * waiting on is withdrawn, and the agent's pointer hides once no reply is using apps. An action
   * the helper is still carrying out for it (a long text being typed) is stopped by stopping the
   * helper, which ends when its input closes; the next request of another reply starts a new one.
   */
  endSession(sessionId: string): void {
    for (const question of this.questions.values()) {
      if (question.sessions.delete(sessionId) && !question.sessions.size) question.cancel.abort()
    }
    for (const [key, owner] of this.picturedFor) if (owner === sessionId) this.picturedFor.delete(key)
    const acting = this.acting.has(sessionId)
    if (acting) this.options.helper.stop()
    const state = this.sessions.get(sessionId)
    if (!state) return
    this.sessions.delete(sessionId)
    for (const file of state.images) void rm(file, { force: true }).catch(() => undefined)
    if (!acting && !this.sessions.size && this.options.helper.started) void this.options.helper.call('release', {}).catch(() => undefined)
  }

  /**
   * The user took an app back in Settings. What a reply is doing in it right now is stopped (by
   * stopping the helper, as when a reply ends), and requests begun under the approval do not go on;
   * the next one asks the user again.
   */
  revoke(account: string, id: string): void {
    const grant = grantKey(account, id)
    this.takenBack.set(grant, (this.takenBack.get(grant) ?? 0) + 1)
    if ([...this.acting.values()].some((action) => action.grant === grant)) this.options.helper.stop()
  }

  shutdown(): void {
    for (const question of this.questions.values()) question.cancel.abort()
    this.sessions.clear()
    this.picturedFor.clear()
    this.options.helper.stop()
  }
}
