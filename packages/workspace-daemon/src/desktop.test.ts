import { readdir, rm, stat } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HELD, NO_SCREEN, ScreenInputError, WorkspaceDesktop, findApp, parseInputEvents } from './desktop.js'
import { alive, chromium, fakeDesktop, terminal, until, type FakeDesktop } from './desktop.fixture.js'

let fake: FakeDesktop
let desktop: WorkspaceDesktop
let now: number

const signal = () => new AbortController().signal
const failure = (attempt: Promise<unknown>) => attempt.then(() => { throw new Error('expected a failure') }, (error: Error) => error.message)
const view = (app = 'Chromium', window?: string) => ({ app, ...(window ? { window } : {}), action: { type: 'view' } })
const click = (extra: Record<string, unknown> = { element: 1 }) => ({ app: 'Chromium', action: { type: 'click', button: 'left', count: 1, ...extra } })
const helperCalls = async (method?: string) => (await fake.calls()).filter((call) => call.command === 'helper' && call.method && (!method || call.method === method))

beforeEach(async () => {
  fake = await fakeDesktop({ elements: [{ index: 1, depth: 0, role: 'button', label: 'More information', x: 10.4, y: 20, width: 80, height: 24, focused: false, extra: 'dropped' }] })
  now = 1_000_000
  desktop = new WorkspaceDesktop({ command: fake.command, versionFile: fake.versionFile, imageDir: fake.imageDir, wait: async () => undefined, now: () => now, log: () => undefined })
})

afterEach(async () => {
  desktop.shutdown()
  await fake.remove()
})

describe('workspace screen apps', () => {
  it('lists the apps with windows open', async () => {
    const listed = await desktop.list(signal())
    expect(listed.result).toEqual({ apps: [
      { name: 'Chromium', allowed: true, frontmost: true, windows: ['Example Domain'] },
      { name: 'XTerm', allowed: true, frontmost: false, windows: ['agent@workspace'] },
    ] })
    expect(listed.output).toBe("Apps with a window open on the workspace's screen: Chromium, XTerm.")
    expect((await helperCalls('configure'))[0]!.params).toEqual({ excludePids: [], imageDir: fake.imageDir, maxImageEdge: 1280 })
  })

  it('shows a window as a picture on disk and its cleaned elements', async () => {
    const { result, output } = await desktop.act(view(), signal())
    expect(result).toEqual({
      app: 'Chromium', window: 'Example Domain', windows: ['Example Domain'],
      image: { path: expect.stringMatching(/\.jpg$/), mimeType: 'image/jpeg', width: 1280, height: 800, sizeBytes: 100 },
      elements: [{ index: 1, depth: 0, role: 'button', label: 'More information', x: 10, y: 20, width: 80, height: 24 }],
      truncated: false,
    })
    expect(output).toBe('Showed Chromium\'s window "Example Domain" with 1 element.')
    expect((await stat(result.image.path)).isFile()).toBe(true)
    expect((await helperCalls('snapshot'))[0]!.params).toEqual({ pid: 400, windowId: 101, maxElements: 300 })
  })

  it('refuses a click on a window the agent has not looked at', async () => {
    expect(await failure(desktop.act(click(), signal()))).toMatch(/^Look at Chromium's window "Example Domain" first/)
    expect(await helperCalls('act')).toEqual([])
    // A key needs no picture.
    expect((await desktop.act({ app: 'Chromium', action: { type: 'key', keys: 'ctrl+l' } }, signal())).result.window).toBe('Example Domain')
  })

  it('shows the dialog a click opened', async () => {
    await desktop.act(view(), signal())
    const dialog = { id: 102, title: 'Save File', minimized: false }
    await fake.set({ afterAct: [chromium([dialog, { id: 101, title: 'Example Domain', minimized: false }]), terminal] })
    const { result } = await desktop.act(click({ x: 5, y: 6 }), signal())
    expect((await helperCalls('act'))[0]!.params).toEqual({ pid: 400, windowId: 101, action: { type: 'click', x: 5, y: 6, button: 'left', count: 1 } })
    expect(result).toMatchObject({ window: 'Save File', windows: ['Save File', 'Example Domain'], note: 'Clicked the button A window opened: "Save File".' })
    // The dialog is now the window the agent was shown, so it can click there.
    await desktop.act(click(), signal())
    expect((await helperCalls('act'))[1]!.params).toMatchObject({ windowId: 102 })
  })

  it('says when the window an action was in closed', async () => {
    await desktop.act(view(), signal())
    await fake.set({ afterAct: [terminal] })
    expect(await failure(desktop.act(click(), signal()))).toBe('Clicked the button, and Chromium has no window open any more.')
    await fake.set({ apps: [chromium(), terminal] })
    expect(await failure(desktop.act(click(), signal()))).toMatch(/^Look at Chromium's window/)
  })

  it('names the running apps when the one asked for is not', async () => {
    expect(await failure(desktop.act(view('Firefox'), signal()))).toBe(
      "No app named \"Firefox\" is running with a window open on the workspace's screen. Running apps: Chromium, XTerm. Start it with a shell command first (`chromium <url>` opens a page in the browser).",
    )
    expect(findApp([chromium(), terminal], 'chrom').name).toBe('Chromium')
    expect(await failure(desktop.act(view('Chromium', 'Inbox'), signal()))).toBe('Chromium has no window titled like "Inbox". Its windows: "Example Domain".')
  })

  it('refuses actions while the owner holds control, but still lets the agent look', async () => {
    await desktop.act(view(), signal())
    desktop.setControl(true)
    expect(await failure(desktop.act(click(), signal()))).toBe(HELD)
    expect(await failure(desktop.act({ app: 'Chromium', action: { type: 'type', text: 'hello' } }, signal()))).toBe(HELD)
    expect((await desktop.act(view(), signal())).result.window).toBe('Example Domain')
    expect((await desktop.list(signal())).result.apps).toHaveLength(2)
    expect(await helperCalls('act')).toEqual([])
    // Control lapses by itself when it is not renewed.
    now += 20_001
    expect(desktop.control.held).toBe(false)
    await desktop.act(click(), signal())
    expect(await helperCalls('act')).toHaveLength(1)
  })

  it('keeps only the latest few pictures', async () => {
    const paths: string[] = []
    for (let shot = 0; shot < 6; shot += 1) paths.push((await desktop.act(view(), signal())).result.image.path)
    expect((await readdir(fake.imageDir)).sort()).toEqual(paths.slice(-4).map((path) => path.split('/').at(-1)).sort())
  })

  it('stops the helper when a running action is cancelled, and starts another for the next request', async () => {
    await desktop.act(view(), signal())
    await fake.set({ actDelayMs: 10_000 })
    const cancel = new AbortController()
    const typing = desktop.act({ app: 'Chromium', action: { type: 'type', text: 'a long text' } }, cancel.signal)
    await until(async () => (await helperCalls('act')).length === 1)
    const [helper] = await helperCalls('act')
    const startedAt = Date.now()
    cancel.abort()
    expect(await failure(typing)).toBe('The request was cancelled.')
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    await until(() => !alive(helper!.pid))
    await fake.set({ actDelayMs: 0 })
    expect((await desktop.list(signal())).result.apps).toHaveLength(2)
    expect((await helperCalls('configure')).length).toBe(2)
  })

  it('stops waiting at once when an operation queued behind another is cancelled', async () => {
    await desktop.act(view(), signal())
    await fake.set({ actDelayMs: 600 })
    const first = desktop.act(click(), signal())
    const cancel = new AbortController()
    const second = desktop.list(cancel.signal)
    cancel.abort()
    expect(await failure(second)).toBe('The request was cancelled.')
    expect((await first).result.note).toBe('Clicked the button')
  })

  it('starts the helper again after it died', async () => {
    await fake.set({ crashOn: 'apps' })
    expect(await failure(desktop.list(signal()))).toBe('The helper that controls apps stopped.')
    expect((await desktop.list(signal())).result.apps).toHaveLength(2)
  })

  it('fails politely when the image has no screen', async () => {
    await rm(fake.versionFile)
    expect(await failure(desktop.list(signal()))).toBe(NO_SCREEN)
    expect(await failure(desktop.act(view(), signal()))).toBe(NO_SCREEN)
    expect(await desktop.status()).toEqual({ available: false, running: false, width: 1280, height: 800, controlled: false })
    expect(await fake.calls()).toEqual([])
  })

  it('reports whether the screen is up without starting anything', async () => {
    expect(await desktop.status()).toEqual({ available: true, running: true, width: 1280, height: 800, controlled: false })
    await fake.set({ status: 1 })
    // Asked again only after a moment.
    expect((await desktop.status()).running).toBe(true)
    now += 2_001
    expect((await desktop.status()).running).toBe(false)
    expect((await fake.calls()).map((call) => call.command)).toEqual(['status', 'status'])
  })
})

describe('workspace screen input', () => {
  const events = { events: [{ type: 'move', x: 10, y: 20 }, { type: 'click', x: 10, y: 20 }, { type: 'text', text: 'hunter2' }, { type: 'key', keys: 'enter' }, { type: 'scroll', x: 1280, y: 800, dy: 3 }] }

  it('is refused without control and carried out on a helper of its own with it', async () => {
    const refused = await desktop.input(events).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(ScreenInputError)
    expect(refused).toMatchObject({ status: 409, message: 'not_controlled' })
    await desktop.act(view(), signal())
    desktop.setControl(true)
    now += 15_000
    await desktop.input(events)
    const [input] = await helperCalls('input')
    expect(input!.params).toEqual({ events: [
      { type: 'move', x: 10, y: 20 }, { type: 'click', x: 10, y: 20, button: 'left', count: 1 }, { type: 'text', text: 'hunter2' },
      { type: 'key', keys: 'enter' }, { type: 'scroll', x: 1280, y: 800, dx: 0, dy: 3 },
    ] })
    expect(input!.pid).not.toBe((await helperCalls('snapshot'))[0]!.pid)
    // Input renewed control.
    now += 15_000
    expect(desktop.control.held).toBe(true)
    // The agent's picture is out of date once the owner used the screen.
    desktop.setControl(false)
    expect(await failure(desktop.act(click(), signal()))).toMatch(/or the user has used the screen since\.$/)
  })

  it('checks every event', () => {
    const bad = (value: unknown) => { try { parseInputEvents(value); return null } catch (error) { return (error as ScreenInputError).message } }
    expect(bad({ events: [] })).toBe('Invalid input: send 1 to 64 events.')
    expect(bad({ events: Array.from({ length: 65 }, () => ({ type: 'move', x: 0, y: 0 })) })).toBe('Invalid input: send 1 to 64 events.')
    expect(bad({ events: [{ type: 'move', x: 1281, y: 0 }] })).toBe('Invalid input: event 1 needs x from 0 to 1280.')
    expect(bad({ events: [{ type: 'move', x: 0, y: -1 }] })).toBe('Invalid input: event 1 needs y from 0 to 800.')
    expect(bad({ events: [{ type: 'down', x: 0, y: 0, button: 'back' }] })).toBe('Invalid input: event 1 has an unknown button.')
    expect(bad({ events: [{ type: 'click', x: 0, y: 0, count: 4 }] })).toBe('Invalid input: event 1 needs a count of 1, 2 or 3.')
    expect(bad({ events: [{ type: 'scroll', x: 0, y: 0, dx: 0, dy: 0 }] })).toBe('Invalid input: event 1 scrolls by nothing.')
    expect(bad({ events: [{ type: 'text', text: 'x'.repeat(2_001) }] })).toBe('Invalid input: event 1 needs text of 1 to 2000 characters.')
    expect(bad({ events: [{ type: 'key', keys: '' }] })).toBe('Invalid input: event 1 needs keys of 1 to 100 characters.')
    expect(bad({ events: [{ type: 'paste' }] })).toBe('Invalid input: event 1 has an unknown type.')
    expect(parseInputEvents({ events: [{ type: 'up', x: 1, y: 2, button: 'right', extra: true }] })).toEqual([{ type: 'up', x: 1, y: 2, button: 'right' }])
  })
})

describe('workspace screen frames', () => {
  it('answers at once with a frame it has not shown, and waits for the next one otherwise', async () => {
    await fake.set({ frames: ['first picture'] })
    const first = (await desktop.frames.next(undefined, 0))!
    expect(first.data.toString()).toBe('first picture')
    expect(first.id).toMatch(/^[a-f0-9]{32}$/)
    expect(await desktop.frames.next(first.id, 0)).toBeNull()
    const startedAt = Date.now()
    expect(await desktop.frames.next(first.id, 150)).toBeNull()
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140)
    const waiting = desktop.frames.next(first.id, 5_000)
    await fake.set({ frames: ['first picture', 'second picture'] })
    expect((await waiting)!.data.toString()).toBe('second picture')
    expect((await fake.calls()).filter((call) => call.command === 'frames')).toEqual([{ command: 'frames', args: ['4'], pid: expect.any(Number) }])
  })

  it('stops the stream when nobody asks for frames, and starts it again on the next request', async () => {
    const quick = new WorkspaceDesktop({ command: fake.command, versionFile: fake.versionFile, imageDir: fake.imageDir, log: () => undefined, frames: { idleMs: 200, restartMs: 0 } })
    try {
      await fake.set({ frames: ['picture'] })
      await quick.frames.next(undefined, 0)
      const [stream] = (await fake.calls()).filter((call) => call.command === 'frames')
      await until(() => !alive(stream!.pid))
      expect(quick.frames.running).toBe(false)
      expect((await quick.frames.next(undefined, 0))!.data.toString()).toBe('picture')
      expect((await fake.calls()).filter((call) => call.command === 'frames')).toHaveLength(2)
    } finally { quick.shutdown() }
  })

  it('fails a request when no picture comes, and when the stream dies', async () => {
    const quick = new WorkspaceDesktop({ command: fake.command, versionFile: fake.versionFile, imageDir: fake.imageDir, log: () => undefined, frames: { firstFrameMs: 300, restartMs: 0 } })
    try {
      const startedAt = Date.now()
      expect(await failure(quick.frames.next(undefined, 0))).toBe("The workspace's screen did not send a picture in time.")
      expect(Date.now() - startedAt).toBeLessThan(2_000)
      await fake.set({ framesExit: true })
      quick.frames.stop()
      expect(await failure(quick.frames.next(undefined, 0))).toBe("The workspace's screen stopped sending pictures.")
      // A stream that died is started again by the next request.
      await fake.set({ framesExit: false, frames: ['back'] })
      expect((await quick.frames.next(undefined, 0))!.data.toString()).toBe('back')
    } finally { quick.shutdown() }
  })

  it('does not start a stream that died again within a moment', async () => {
    const quick = new WorkspaceDesktop({ command: fake.command, versionFile: fake.versionFile, imageDir: fake.imageDir, log: () => undefined, frames: { restartMs: 60_000 } })
    try {
      await fake.set({ framesExit: true })
      expect(await failure(quick.frames.next(undefined, 0))).toBe("The workspace's screen stopped sending pictures.")
      expect(await failure(quick.frames.next(undefined, 0))).toBe("The workspace's screen stopped sending pictures.")
      expect((await fake.calls()).filter((call) => call.command === 'frames')).toHaveLength(1)
    } finally { quick.shutdown() }
  })
})

describe('the pictures folder', () => {
  it('is emptied of an earlier run’s pictures when the first helper starts', async () => {
    await desktop.act(view(), signal())
    const left = (await readdir(fake.imageDir))[0]!
    const next = new WorkspaceDesktop({ command: fake.command, versionFile: fake.versionFile, imageDir: fake.imageDir, wait: async () => undefined, log: () => undefined })
    try {
      const { result } = await next.act(view(), signal())
      expect(await readdir(fake.imageDir)).toEqual([result.image.path.split('/').at(-1)])
      expect(result.image.path.endsWith(left)).toBe(false)
    } finally { next.shutdown() }
  })
})
