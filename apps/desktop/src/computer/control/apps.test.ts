import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPUTER_INLINE_MAX_BYTES, type ComputerAllowedApp, type ComputerAppAction } from '@pulpo/contracts'
import { ComputerError } from '../errors'
import { AppControl, appControlCapability, appNeverAllowed, findApp, findWindow, type AppControlSession } from './apps'
import { ControlHelperError } from './helper'
import type { ControlApp, ControlElement, ControlMethod } from './protocol'

const textEdit = (windows = [{ id: 11, title: 'Notes.txt', minimized: false }, { id: 12, title: 'Untitled', minimized: false }]): ControlApp => (
  { id: 'com.apple.TextEdit', name: 'TextEdit', pid: 500, frontmost: false, windows }
)
const safari: ControlApp = { id: 'com.apple.Safari', name: 'Safari', pid: 600, frontmost: true, windows: [{ id: 21, title: 'Bank — Accounts', minimized: false }] }
const pulpo: ControlApp = { id: 'com.isaacthoman.pulpo.desktop', name: 'Pulpo', pid: 700, frontmost: false, windows: [{ id: 31, title: 'Pulpo', minimized: false }] }

interface Harness {
  control: AppControl
  session: AppControlSession
  /** What the helper was asked, in order. */
  asked: Array<{ method: ControlMethod; params: Record<string, unknown> }>
  confirm: ReturnType<typeof vi.fn>
  allowed: ComputerAllowedApp[]
  running: { apps: ControlApp[] }
  state: { active: boolean; imageBytes: number; started: boolean; stopped: number; fail: Partial<Record<ControlMethod, ControlHelperError>>; elements: ControlElement[]; /** What an action does to the windows that are open. */ onAct?: () => void; /** Holds an action until it settles, as a long text being typed does. */ hold?: Promise<void>; options: Array<{ timeoutMs?: number; stillWanted?: () => boolean } | undefined> }
}

let base: string

function harness(platform: NodeJS.Platform = 'darwin'): Harness {
  const imageDir = path.join(base, 'images')
  const asked: Harness['asked'] = []
  const running = { apps: [safari, textEdit(), pulpo] }
  const state: Harness['state'] = { active: true, imageBytes: 1_000, started: false, stopped: 0, fail: {}, options: [], elements: [{ index: 1, depth: 0, role: 'button', label: 'Save', x: 10.4, y: 20, width: 80, height: 24 }] }
  let shots = 0
  const helper = {
    get started() { return state.started },
    stop: () => { state.stopped += 1; state.started = false },
    call: vi.fn(async (method: ControlMethod, params: Record<string, unknown>, options?: { timeoutMs?: number; stillWanted?: () => boolean }) => {
      state.started = true
      asked.push({ method, params })
      state.options.push(options)
      if (method === 'act' && state.hold) await state.hold
      const failure = state.fail[method]
      if (failure) throw failure
      if (method === 'apps') return { apps: running.apps }
      if (method === 'permissions') return { accessibility: false, screenRecording: false }
      if (method === 'act') { state.onAct?.(); return { note: 'Pressed the Save button' } }
      if (method === 'release') return {}
      if (method === 'snapshot') {
        await mkdir(imageDir, { recursive: true })
        const file = path.join(imageDir, `shot-${++shots}.jpg`)
        await writeFile(file, Buffer.alloc(state.imageBytes, 7))
        const window = running.apps.flatMap((app) => app.windows).find((candidate) => candidate.id === params.windowId)
        if (!window) throw new ControlHelperError('not_found', 'The window is gone.')
        return { window, image: { path: file, width: 800, height: 600, mimeType: 'image/jpeg' }, elements: state.elements, truncated: false }
      }
      throw new Error(`unexpected ${method}`)
    }),
  }
  const confirm = vi.fn(async (_message: string, _detail: string, _signal: AbortSignal) => true)
  const allowed: ComputerAllowedApp[] = []
  const control = new AppControl({ helper: helper as never, platform, imageDir, confirmApp: confirm, wait: async () => undefined })
  const session: AppControlSession = {
    sessionId: 's1', account: 'https://pulpo.example user-a', active: () => state.active,
    allowedApps: async () => [...allowed],
    allowApp: async (app) => { allowed.unshift(app) },
  }
  return { control, session, asked, confirm, allowed, running, state }
}

const view = (app = 'TextEdit', window?: string) => ({ app, ...(window ? { window } : {}), action: { type: 'view' } as ComputerAppAction })
const click = (extra: Record<string, unknown> = { element: 1 }) => ({ app: 'TextEdit', action: { type: 'click', button: 'left', count: 1, ...extra } as ComputerAppAction })
const refusal = async (attempt: Promise<unknown>) => {
  const error = await attempt.then(() => null, (thrown: unknown) => thrown)
  if (!(error instanceof ComputerError)) throw new Error(`expected a refusal, got ${String(error)}`)
  return { code: error.code, message: error.message }
}

beforeEach(async () => { base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-apps-')) })
afterEach(async () => { await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) })

describe('which app and window the agent means', () => {
  const apps = [safari, textEdit(), { ...textEdit(), id: 'com.example.TextMate', name: 'TextMate', pid: 501 }]

  it('finds an app by its name, however it is written, or by its id', () => {
    expect(findApp(apps, 'textedit').pid).toBe(500)
    expect(findApp(apps, 'TextEdit.app').pid).toBe(500)
    expect(findApp(apps, 'com.apple.Safari').pid).toBe(600)
    expect(findApp(apps, 'Saf').pid).toBe(600)
  })

  it('asks back rather than guess between two apps, and says what is running when there is none', () => {
    expect(() => findApp(apps, 'Text')).toThrow(/could be TextEdit or TextMate/)
    expect(() => findApp(apps, 'Notepad')).toThrow(/Running apps: Safari, TextEdit, TextMate/)
    expect(() => findApp(apps, '  ')).toThrow(ComputerError)
  })

  it('takes two instances of one program for the same app, the front one first', () => {
    expect(findApp([{ ...textEdit(), pid: 1 }, { ...textEdit(), pid: 2 }], 'TextEdit').pid).toBe(1)
  })

  it('picks the front window, or the one whose title matches', () => {
    expect(findWindow(textEdit(), undefined).id).toBe(11)
    expect(findWindow(textEdit(), 'untitled').id).toBe(12)
    expect(findWindow(textEdit(), 'notes').id).toBe(11)
    expect(() => findWindow(textEdit(), 'Budget')).toThrow(/Its windows: "Notes.txt", "Untitled"/)
    expect(() => findWindow(textEdit([]), undefined)).toThrow(/no window open/)
  })
})

describe('what can be controlled', () => {
  it('works in the background on macOS, with the user\'s pointer on Windows, and nowhere else', () => {
    expect(appControlCapability('darwin')).toEqual({ version: 1, background: true })
    expect(appControlCapability('win32')).toEqual({ version: 1, background: false })
    expect(appControlCapability('linux')).toBeNull()
  })

  it('never includes Pulpo itself or the system\'s security prompts', () => {
    for (const id of ['com.isaacthoman.pulpo.desktop', 'Pulpo.exe', 'com.apple.SecurityAgent', 'com.apple.loginwindow', 'consent.exe']) expect(appNeverAllowed(id)).toBe(true)
    expect(appNeverAllowed('com.apple.TextEdit')).toBe(false)
  })
})

describe('app control', () => {
  it('lists running apps without Pulpo, and window titles only of apps the user allowed', async () => {
    const h = harness()
    expect(await h.control.list(h.session)).toEqual({ apps: [
      { name: 'Safari', allowed: false, frontmost: true, windows: [] },
      { name: 'TextEdit', allowed: false, frontmost: false, windows: [] },
    ] })
    h.allowed.push({ id: 'com.apple.textedit', name: 'TextEdit' })
    expect((await h.control.list(h.session)).apps[1]).toEqual({ name: 'TextEdit', allowed: true, frontmost: false, windows: ['Notes.txt', 'Untitled'] })
  })

  it('asks the user about an app once, remembers the answer, and then shows its front window', async () => {
    const h = harness()
    const state = await h.control.act(h.session, view(), 210_000)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.confirm.mock.calls[0]![0]).toBe('Let Pulpo Agent use TextEdit?')
    expect(h.confirm.mock.calls[0]![1]).toContain('pointer of its own')
    expect(h.allowed).toEqual([{ id: 'com.apple.TextEdit', name: 'TextEdit' }])
    expect(state).toMatchObject({ app: 'TextEdit', window: 'Notes.txt', windows: ['Notes.txt', 'Untitled'], truncated: false })
    expect(state.elements).toEqual([{ index: 1, depth: 0, role: 'button', label: 'Save', x: 10, y: 20, width: 80, height: 24 }])
    expect(state.image).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 600, sizeBytes: 1_000 })
    expect(Buffer.from(state.image.data!, 'base64').byteLength).toBe(1_000)
    // An inline picture is not kept.
    expect(await readdir(path.join(base, 'images'))).toEqual([])
    await h.control.act(h.session, view(), 210_000)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.asked.filter((request) => request.method === 'snapshot').map((request) => request.params)).toEqual([
      { pid: 500, windowId: 11, maxElements: 300 }, { pid: 500, windowId: 11, maxElements: 300 },
    ])
  })

  it('says on Windows that the user\'s own pointer and keyboard are used', async () => {
    const h = harness('win32')
    await h.control.act(h.session, view(), 210_000)
    expect(h.confirm.mock.calls[0]![1]).toContain('uses your pointer and keyboard')
  })

  it('does nothing in an app the user refused, and does not ask again in that reply', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(false)
    expect(await refusal(h.control.act(h.session, view(), 210_000))).toMatchObject({ code: 'not_allowed', message: expect.stringContaining('has not allowed Pulpo Agent to use TextEdit') })
    expect(await refusal(h.control.act(h.session, click(), 210_000))).toMatchObject({ code: 'not_allowed' })
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.allowed).toEqual([])
    expect(h.asked.some((request) => request.method === 'snapshot' || request.method === 'act')).toBe(false)
    // Another reply may ask again.
    h.confirm.mockResolvedValue(true)
    await h.control.act({ ...h.session, sessionId: 's2' }, view(), 210_000)
    expect(h.confirm).toHaveBeenCalledTimes(2)
  })

  it('withdraws its question when the reply ends, and remembers nothing', async () => {
    const h = harness()
    let asked: AbortSignal | undefined
    // A dialog closed by its signal answers like any other; that answer must not count.
    h.confirm.mockImplementation((_message: string, _detail: string, signal: AbortSignal) => new Promise<boolean>((resolve) => { asked = signal; signal.addEventListener('abort', () => resolve(true)) }))
    const attempt = h.control.act(h.session, view(), 210_000)
    await vi.waitFor(() => expect(asked).toBeDefined())
    h.control.endSession('s1')
    h.state.active = false
    expect(await refusal(attempt)).toMatchObject({ code: 'unknown_session' })
    expect(asked!.aborted).toBe(true)
    expect(h.allowed).toEqual([])
  })

  it('puts one question for two requests about the same app', async () => {
    const h = harness()
    let answer!: (allowed: boolean) => void
    h.confirm.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve }))
    const first = h.control.act(h.session, view(), 210_000)
    const second = h.control.act({ ...h.session, sessionId: 's2' }, view(), 210_000)
    await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.confirm).toHaveBeenCalledTimes(1)
    answer(true)
    expect((await first).app).toBe('TextEdit')
    expect((await second).app).toBe('TextEdit')
  })

  it('never asks about Pulpo itself: to the agent it is not running', async () => {
    const h = harness()
    expect(await refusal(h.control.act(h.session, view('Pulpo'), 210_000))).toMatchObject({ code: 'not_found' })
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('acts only in the window it last showed, then shows it again', async () => {
    const h = harness()
    expect(await refusal(h.control.act(h.session, click(), 210_000))).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('Look at TextEdit\'s window "Notes.txt" first') })
    await h.control.act(h.session, view('TextEdit', 'Untitled'), 210_000)
    const state = await h.control.act(h.session, click({ element: 1 }), 210_000)
    expect(h.asked.find((request) => request.method === 'act')!.params).toEqual({ pid: 500, windowId: 12, action: { type: 'click', button: 'left', count: 1, element: 1 } })
    expect(state).toMatchObject({ window: 'Untitled', note: 'Pressed the Save button' })
    // A click in a window named outright must be one the agent was shown.
    expect(await refusal(h.control.act(h.session, { ...click(), window: 'Notes' }, 210_000))).toMatchObject({ code: 'invalid_request' })
    // Typing needs no picture.
    await h.control.act(h.session, { app: 'TextEdit', window: 'Notes', action: { type: 'type', text: 'hi' } }, 210_000)
    expect(h.asked.filter((request) => request.method === 'act').at(-1)!.params).toMatchObject({ windowId: 11, action: { type: 'type', text: 'hi' } })
  })

  it('follows a window the action opened, and falls back when the window closed', async () => {
    const h = harness()
    await h.control.act(h.session, view(), 210_000)
    // The click opens a dialog in front.
    h.state.onAct = () => { h.running.apps = [safari, textEdit([{ id: 13, title: 'Save', minimized: false }, { id: 11, title: 'Notes.txt', minimized: false }, { id: 12, title: 'Untitled', minimized: false }])] }
    const opened = await h.control.act(h.session, click(), 210_000)
    expect(opened).toMatchObject({ window: 'Save', windows: ['Save', 'Notes.txt', 'Untitled'], note: 'Pressed the Save button A window opened: "Save".' })
    // The next click, with no window named, lands in the dialog; pressing its button closes it.
    h.state.onAct = () => { h.running.apps = [safari, textEdit()] }
    const closed = await h.control.act(h.session, click(), 210_000)
    expect(h.asked.filter((request) => request.method === 'act').at(-1)!.params).toMatchObject({ windowId: 13 })
    expect(closed).toMatchObject({ window: 'Notes.txt', note: 'Pressed the Save button That window closed; this is "Notes.txt".' })
    // An app that quit has nothing left to show, but what was asked for was done.
    h.state.onAct = () => { h.running.apps = [safari] }
    expect(await refusal(h.control.act(h.session, { app: 'TextEdit', action: { type: 'key', keys: 'cmd+q' } }, 210_000))).toMatchObject({ code: 'not_found', message: 'Pressed the Save button, and TextEdit has no window open any more.' })
  })

  it('leaves a large picture where it is for the server to fetch, until the next one', async () => {
    const h = harness()
    h.state.imageBytes = COMPUTER_INLINE_MAX_BYTES + 1
    const first = await h.control.act(h.session, view(), 210_000)
    expect(first.image.data).toBeUndefined()
    expect(first.image.path).toBe(path.join(base, 'images', 'shot-1.jpg'))
    expect(await readdir(path.join(base, 'images'))).toEqual(['shot-1.jpg'])
    const second = await h.control.act(h.session, view(), 210_000)
    expect(await readdir(path.join(base, 'images'))).toEqual([path.basename(second.image.path!)])
    h.control.endSession('s1')
    await vi.waitFor(async () => expect(await readdir(path.join(base, 'images'))).toEqual([]))
  })

  it('shows the system\'s request once when macOS has not allowed Pulpo, and tells the agent to wait for the user', async () => {
    const h = harness()
    h.allowed.push({ id: 'com.apple.TextEdit', name: 'TextEdit' })
    h.state.fail.snapshot = new ControlHelperError('permission_denied', 'Screen Recording is not allowed.')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await refusal(h.control.act(h.session, view(), 210_000))).toMatchObject({ code: 'not_allowed', message: expect.stringMatching(/Screen Recording is not allowed\).*Privacy & Security/) })
    }
    expect(h.asked.filter((request) => request.method === 'permissions')).toEqual([{ method: 'permissions', params: { prompt: true } }])
    // The helper is replaced, so the next one starts with what the user allowed meanwhile.
    expect(h.state.stopped).toBe(2)
  })

  it('tells the agent to look again when an element is gone', async () => {
    const h = harness()
    await h.control.act(h.session, view(), 210_000)
    h.state.fail.act = new ControlHelperError('stale_element', 'Element 9 is not in the window any more.')
    expect(await refusal(h.control.act(h.session, click({ element: 9 }), 210_000))).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('look at it again') })
  })

  it('stops an action still being carried out when its reply ends', async () => {
    const h = harness()
    await h.control.act(h.session, view(), 210_000)
    let finish!: () => void
    h.state.hold = new Promise<void>((resolve) => { finish = resolve })
    const typing = h.control.act(h.session, { app: 'TextEdit', action: { type: 'type', text: 'a long text' } }, 210_000)
    await vi.waitFor(() => expect(h.asked.at(-1)?.method).toBe('act'))
    // The user stops the reply: the helper is stopped rather than asked to hide a pointer after the typing.
    h.state.active = false
    h.control.endSession('s1')
    expect(h.state.stopped).toBe(1)
    expect(h.asked.some((request) => request.method === 'release')).toBe(false)
    finish()
    expect(await refusal(typing)).toMatchObject({ code: 'unknown_session' })
    // The helper is told how to learn that a request waiting its turn is no longer wanted.
    const options = h.state.options[h.asked.findIndex((request) => request.method === 'act')]
    expect(options?.stillWanted?.()).toBe(false)
  })

  it('stops what it is doing in an app the user takes back, and does not go on under the old approval', async () => {
    const h = harness()
    await h.control.act(h.session, view(), 210_000)
    let finish!: () => void
    h.state.hold = new Promise<void>((resolve) => { finish = resolve })
    const typing = h.control.act(h.session, { app: 'TextEdit', action: { type: 'type', text: 'a long text' } }, 210_000)
    await vi.waitFor(() => expect(h.asked.at(-1)?.method).toBe('act'))
    // Remove in Settings: the grant goes (the service does that) and the control is told.
    h.allowed.length = 0
    h.control.revoke(h.session.account, 'com.apple.textedit')
    expect(h.state.stopped).toBe(1)
    const stillWanted = h.state.options[h.asked.findIndex((request) => request.method === 'act')]?.stillWanted
    expect(stillWanted?.()).toBe(false)
    finish()
    expect(await refusal(typing)).toMatchObject({ code: 'not_allowed', message: expect.stringContaining('took back Pulpo Agent\'s use of TextEdit') })
    // No picture of the app follows, and the next use asks the user again.
    expect(h.asked.filter((request) => request.method === 'snapshot')).toHaveLength(1)
    h.state.hold = undefined
    await h.control.act(h.session, view(), 210_000)
    expect(h.confirm).toHaveBeenCalledTimes(2)
    // Taking back another app touches nothing here.
    const before = h.state.stopped
    h.control.revoke(h.session.account, 'com.apple.Safari')
    expect(h.state.stopped).toBe(before)
  })

  it('takes a number only from the picture this reply was shown, not one taken for another reply since', async () => {
    const h = harness()
    const other: AppControlSession = { ...h.session, sessionId: 's2' }
    await h.control.act(h.session, view(), 210_000)
    // Another reply of the same user looks at the same window: the helper's elements are now that picture's.
    await h.control.act(other, view(), 210_000)
    expect(await refusal(h.control.act(h.session, click(), 210_000))).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('pictured for another reply meanwhile') })
    expect(h.asked.some((request) => request.method === 'act')).toBe(false)
    // The other reply's numbers are good, and this one's are again once it has looked.
    await h.control.act(other, click(), 210_000)
    await h.control.act(h.session, view(), 210_000)
    await h.control.act(h.session, click(), 210_000)
    expect(h.asked.filter((request) => request.method === 'act')).toHaveLength(2)
    // A reply that ended leaves nothing behind that could vouch for a later one.
    h.control.endSession('s1')
    expect(await refusal(h.control.act({ ...h.session, sessionId: 's3' }, click(), 210_000))).toMatchObject({ code: 'invalid_request' })
  })

  it('does nothing for a reply that is over, and puts the agent\'s pointer away with the last one', async () => {
    const h = harness()
    await h.control.act(h.session, view(), 210_000)
    h.state.active = false
    expect(await refusal(h.control.act(h.session, click(), 210_000))).toMatchObject({ code: 'unknown_session' })
    expect(h.asked.some((request) => request.method === 'act')).toBe(false)
    h.control.endSession('s1')
    expect(h.asked.at(-1)).toEqual({ method: 'release', params: {} })
    // A reply that never used an app starts no helper to hide a pointer nobody saw.
    const idle = harness()
    idle.control.endSession('s9')
    expect(idle.asked).toEqual([])
  })
})
