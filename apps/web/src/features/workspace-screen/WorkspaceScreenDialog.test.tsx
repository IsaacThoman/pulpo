// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceScreenDialog } from './WorkspaceScreenDialog'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ready = { state: 'ready', width: 1280, height: 800, controlled: false }

/** A fake server for the screen's routes; a frame request with `after` waits until the viewer stops it. */
function serve(overrides: Partial<Record<'status' | 'frame' | 'control' | 'input', Handler>> = {}) {
  const requests: Array<{ path: string; body?: unknown }> = []
  const handlers: Record<'status' | 'frame' | 'control' | 'input', Handler> = {
    status: () => json(ready),
    frame: (url, init) => new URL(url, 'http://pulpo.test').searchParams.has('after')
      ? new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      : new Response(new Blob(['jpeg'], { type: 'image/jpeg' }), { headers: { 'content-type': 'image/jpeg', 'x-pulpo-frame': 'abcdef0123456789' } }),
    control: (_url, init) => json({ held: JSON.parse(String(init.body)).held }),
    input: () => new Response(null, { status: 204 }),
    ...overrides,
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    const path = new URL(url, 'http://pulpo.test').pathname
    requests.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const route = path.endsWith('/frame') ? 'frame' : path.endsWith('/control') ? 'control' : path.endsWith('/input') ? 'input' : 'status'
    return handlers[route](url, init)
  }))
  return requests
}

function Harness() {
  const [open, setOpen] = useState(true)
  return <WorkspaceScreenDialog chatId="chat-1" open={open} onOpenChange={setOpen} />
}

beforeEach(() => {
  let next = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:frame-${++next}`),
    revokeObjectURL: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkspaceScreenDialog', () => {
  it('shows the live picture and lets the owner take control, type, and hand back', async () => {
    const requests = serve()
    render(<Harness />)
    expect(screen.getByRole('dialog', { name: 'Workspace screen' })).toBeTruthy()
    const picture = await screen.findByRole('img', { name: 'Workspace screen, live' })
    await waitFor(() => expect(picture.querySelector('img')?.getAttribute('src')).toBe('blob:frame-1'))
    expect(screen.getByRole('status').textContent).toContain('Watching')
    await waitFor(() => expect(requests.filter((request) => request.path.endsWith('/frame'))).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    const region = await screen.findByRole('application', { name: 'Workspace screen. Your clicks and keys go to the workspace. Press Escape twice to hand back.' })
    expect(screen.getByRole('status').textContent).toContain("You're in control")
    expect(requests.find((request) => request.path.endsWith('/control'))?.body).toEqual({ held: true })

    fireEvent.keyDown(region, { key: 'h' })
    fireEvent.keyDown(region, { key: 'Enter' })
    await waitFor(() => expect(requests.filter((request) => request.path.endsWith('/input')).flatMap((request) => (request.body as { events: unknown[] }).events))
      .toEqual([{ type: 'text', text: 'h' }, { type: 'key', keys: 'enter' }]))

    // Escape is the workspace's while in control, so the dialog stays open.
    fireEvent.keyDown(region, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await screen.findByRole('button', { name: 'Take control' })
    expect(requests.filter((request) => request.path.endsWith('/control')).at(-1)?.body).toEqual({ held: false })
  })

  it('hands control back by keyboard when Escape is pressed twice', async () => {
    const requests = serve()
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Take control' }))
    const region = await screen.findByRole('application')
    // One Escape, then another key, is just keys for the workspace.
    fireEvent.keyDown(region, { key: 'Escape' })
    fireEvent.keyDown(region, { key: 'a' })
    fireEvent.keyDown(region, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeTruthy()
    fireEvent.keyDown(region, { key: 'Escape' })
    await screen.findByRole('button', { name: 'Take control' })
    expect(screen.queryByRole('dialog')).toBeTruthy()
    expect(requests.filter((request) => request.path.endsWith('/control')).at(-1)?.body).toEqual({ held: false })
    const sent = requests.filter((request) => request.path.endsWith('/input')).flatMap((request) => (request.body as { events: Array<{ keys?: string }> }).events)
    // The second of the pair was not sent on (handing back may also drop keys still waiting to go).
    expect(sent.filter((event) => event.keys === 'escape').length).toBeLessThanOrEqual(2)
  })

  it('hands control back when the dialog is closed', async () => {
    const requests = serve()
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Take control' }))
    await screen.findByRole('button', { name: 'Hand back' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(requests.filter((request) => request.path.endsWith('/control')).at(-1)?.body).toEqual({ held: false }))
  })

  it('gives control straight back when it arrives after the dialog was closed', async () => {
    let grant!: (response: Response) => void
    const requests = serve({
      control: (_url, init) => JSON.parse(String(init.body)).held
        ? new Promise<Response>((resolve) => { grant = resolve })
        : json({ held: false }),
    })
    function Reopenable() {
      const [open, setOpen] = useState(true)
      return <><button onClick={() => setOpen(true)}>reopen</button><WorkspaceScreenDialog chatId="chat-1" open={open} onOpenChange={setOpen} /></>
    }
    render(<Reopenable />)
    fireEvent.click(await screen.findByRole('button', { name: 'Take control' }))
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/control'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(async () => { grant(json({ held: true })) })
    await waitFor(() => expect(requests.filter((request) => request.path.endsWith('/control')).at(-1)?.body).toEqual({ held: false }))
    // Opened again, the viewer is watching and can take control afresh.
    fireEvent.click(screen.getByText('reopen'))
    const take = await screen.findByRole('button', { name: 'Take control' })
    expect((take as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('Watching')
  })

  it('goes back to watching and says so when control was lost', async () => {
    serve({ input: () => json({ error: { code: 'workspace_screen_not_controlled', message: 'Not in control' } }, 409) })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Take control' }))
    const region = await screen.findByRole('application')
    fireEvent.keyDown(region, { key: 'a' })
    await screen.findByRole('button', { name: 'Take control' })
    expect(screen.getByRole('status').textContent).toContain("Control ended, so you're watching again.")
  })

  it('says when the chat has no running workspace, or the workspace has no screen', async () => {
    serve({ status: () => json({ ...ready, state: 'none' }) })
    const first = render(<Harness />)
    expect(await screen.findByText(/No workspace is running for this chat\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull()
    first.unmount()

    serve({ status: () => json({ ...ready, state: 'unavailable' }) })
    render(<Harness />)
    expect(await screen.findByText('This workspace has no screen.')).toBeTruthy()
  })

  it('shows the none text when the workspace goes away while watching', async () => {
    serve({ frame: () => json({ error: { code: 'workspace_screen_unavailable', message: 'Gone' } }, 404) })
    render(<Harness />)
    expect(await screen.findByText(/No workspace is running for this chat\./)).toBeTruthy()
  })

  it('offers to try again when the status could not be loaded', async () => {
    let failing = true
    serve({ status: () => failing ? json({ error: { message: 'Down' } }, 503) : json(ready) })
    render(<Harness />)
    expect(await screen.findByText("Couldn't load the screen.")).toBeTruthy()
    failing = false
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByRole('button', { name: 'Take control' })).toBeTruthy()
  })
})
