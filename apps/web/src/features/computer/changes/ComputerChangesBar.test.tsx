// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComputerChange, ComputerChangeDetail, ComputerChangesItem, DesktopComputerApi } from '@pulpo/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerChangesBar } from './ComputerChangesBar'
import { computerFolderName, computerPathTail } from './bridge'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})

const SESSION = '00000000-0000-4000-8000-000000000001'
const item: ComputerChangesItem = { type: 'pulpo_computer_changes', id: 'cc', session_id: SESSION, applied: 0, suggested: 3 }

function change(overrides: Partial<ComputerChange>): ComputerChange {
  return {
    id: 'c1', sessionId: SESSION, responseId: '00000000-0000-4000-8000-0000000000aa', folder: '/Users/me/Projects/site',
    path: 'index.html', kind: 'update', status: 'pending', createdAt: '2026-11-18T00:00:00.000Z', ...overrides,
  }
}

/** A desktop store: decisions change the records and notify listeners, as the main process does. */
function installBridge(initial: ComputerChange[], details: Record<string, Partial<ComputerChangeDetail>> = {}) {
  let changes = initial
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  const decide = (ids: string[], status: ComputerChange['status']) => {
    changes = changes.map((entry) => ids.includes(entry.id) ? { ...entry, status } : entry)
    notify()
    return changes.filter((entry) => ids.includes(entry.id))
  }
  const api = {
    list: vi.fn(async (filter: { sessionIds?: string[]; folder?: string }) => changes.filter((entry) => (
      (!filter.sessionIds || filter.sessionIds.includes(entry.sessionId)) && (filter.folder === undefined || entry.folder === filter.folder)
    ))),
    get: vi.fn(async (id: string) => {
      const found = changes.find((entry) => entry.id === id)
      return found ? { before: null, after: null, binary: false, ...found, ...details[id] } : null
    }),
    accept: vi.fn(async (ids: string[], _options?: { overwrite?: boolean }) => decide(ids, 'accepted')),
    reject: vi.fn(async (ids: string[]) => decide(ids, 'rejected')),
    onChanged: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  const computer = { changes: api } as unknown as DesktopComputerApi
  Object.defineProperty(window, 'pulpoDesktop', { configurable: true, value: { computer } })
  return {
    api,
    /** Makes the next accept of `id` find the file changed on disk. */
    conflictOnAccept(id: string) {
      api.accept.mockImplementationOnce(async (ids, options) => options?.overwrite ? decide(ids, 'accepted') : decide([id], 'conflict'))
    },
  }
}

afterEach(() => {
  cleanup()
  delete (window as { pulpoDesktop?: unknown }).pulpoDesktop
})

describe('computerFolderName', () => {
  it('takes the last segment on macOS and Windows', () => {
    expect(computerFolderName('/Users/me/Projects/site/')).toBe('site')
    expect(computerFolderName('C:\\Users\\me\\Documents')).toBe('Documents')
  })
})

describe('ComputerChangesBar', () => {
  it('shows the reply counts as a plain line without the desktop bridge', () => {
    render(<ComputerChangesBar item={{ ...item, applied: 1 }} />)
    expect(screen.getByText('Suggested 3 changes on your computer · Changed 1 file on your computer')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers everything waiting for review in the folder, whichever reply suggested it', async () => {
    installBridge([
      change({ id: 'mine', path: 'index.html' }),
      change({ id: 'theirs', path: 'about.html', sessionId: '00000000-0000-4000-8000-0000000000ff' }),
      change({ id: 'elsewhere', path: 'notes.md', sessionId: '00000000-0000-4000-8000-0000000000ff', folder: '/Users/me/Other' }),
      change({ id: 'decided', path: 'old.html', sessionId: '00000000-0000-4000-8000-0000000000ff', status: 'rejected' }),
    ])
    render(<ComputerChangesBar item={item} />)
    expect(await screen.findByText('2 suggested changes in site')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('index.html').length).toBeGreaterThan(0)
    expect(within(dialog).getAllByText('about.html').length).toBeGreaterThan(0)
    expect(within(dialog).queryByText('notes.md')).toBeNull()
    expect(within(dialog).queryByText('old.html')).toBeNull()
  })

  it('shows the plain line when this app does not know the session', async () => {
    const bridge = installBridge([])
    render(<ComputerChangesBar item={{ ...item, suggested: 1 }} />)
    expect(await screen.findByText('Suggested 1 change on your computer')).toBeTruthy()
    expect(bridge.api.list).toHaveBeenCalledWith({ sessionIds: [SESSION] })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('counts applied changes in the folder', async () => {
    installBridge([change({ status: 'applied' }), change({ id: 'c2', path: 'about.html', status: 'applied' })])
    render(<ComputerChangesBar item={{ ...item, applied: 2, suggested: 0 }} />)
    expect(await screen.findByText('Changed 2 files in site')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })

  it('offers a review while suggestions are pending and follows the store', async () => {
    installBridge([change({})])
    render(<ComputerChangesBar item={item} />)
    expect(await screen.findByText('1 suggested change in site')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
  })
})

describe('Suggested changes review', () => {
  async function openReview() {
    render(<ComputerChangesBar item={item} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    return screen.getByRole('dialog', { name: 'Suggested changes' })
  }

  it('shows a diff for an edit and a note for other kinds, then accepts and rejects one by one', async () => {
    const bridge = installBridge([
      change({}),
      change({ id: 'c2', path: 'assets', kind: 'mkdir' }),
      change({ id: 'c3', path: 'old.html', kind: 'move', to: 'archive/old.html' }),
    ], { c1: { before: '<h1>Hi</h1>\n', after: '<h1>Hello</h1>\n' } })
    const dialog = await openReview()
    const list = within(dialog).getByRole('list', { name: 'Suggested changes' })
    expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual(['index.htmledited', 'assetsnew folder', 'old.htmlmoved'])

    expect(await within(dialog).findByText('<h1>Hello</h1>')).toBeTruthy()
    expect(within(dialog).getByText('<h1>Hi</h1>')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(bridge.api.accept).toHaveBeenCalledWith(['c1']))
    // The next change takes its place.
    expect(await within(dialog).findByText('Creates this folder.')).toBeTruthy()
    expect(within(list).queryByText('index.html')).toBeNull()

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(within(dialog).getByText('Moves it to archive/old.html.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(bridge.api.reject).toHaveBeenCalledWith(['c3']))
    expect(await within(dialog).findByText('Creates this folder.')).toBeTruthy()
  })

  it('accepts all pending changes and closes when none are left', async () => {
    const bridge = installBridge([change({}), change({ id: 'c2', path: 'new.txt', kind: 'create' })], { c2: { after: 'hello' } })
    const dialog = await openReview()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept all' }))
    await waitFor(() => expect(bridge.api.accept).toHaveBeenCalledWith(['c1', 'c2']))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Changed 2 files in site')).toBeTruthy()
  })

  it('rejects all', async () => {
    const bridge = installBridge([change({}), change({ id: 'c2', path: 'gone.txt', kind: 'remove' })])
    const dialog = await openReview()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject all' }))
    await waitFor(() => expect(bridge.api.reject).toHaveBeenCalledWith(['c1', 'c2']))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Reviewed 2 suggested changes')).toBeTruthy()
  })

  it('turns a stale accept into a conflict that only Overwrite applies', async () => {
    const bridge = installBridge([change({})], { c1: { before: 'a', after: 'b' } })
    bridge.conflictOnAccept('c1')
    const dialog = await openReview()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByText('This file changed on your computer since the suggestion.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Accept' })).toBeNull()
    // Accept all leaves conflicts to an explicit overwrite.
    expect((within(dialog).getByRole('button', { name: 'Accept all' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(bridge.api.accept).toHaveBeenLastCalledWith(['c1'], { overwrite: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('says a folder suggested for removal is no longer empty, and removes it only when told to', async () => {
    const bridge = installBridge([change({ path: 'drafts', kind: 'remove', status: 'conflict' })], { c1: {} })
    const dialog = await openReview()
    expect(within(dialog).getByText('This folder is no longer empty.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Overwrite' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove anyway' }))
    await waitFor(() => expect(bridge.api.accept).toHaveBeenLastCalledWith(['c1'], { overwrite: true }))
  })

  it('rejects a conflict', async () => {
    const bridge = installBridge([change({ status: 'conflict' })], { c1: { before: 'a', after: 'b' } })
    const dialog = await openReview()
    expect(within(dialog).getByText('This file changed on your computer since the suggestion.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(bridge.api.reject).toHaveBeenCalledWith(['c1']))
  })

  it('says when a file cannot be shown', async () => {
    installBridge([change({}), change({ id: 'c2', path: 'logo.png', kind: 'create' })], { c1: { binary: true }, c2: { binary: true } })
    const dialog = await openReview()
    expect(await within(dialog).findByText("This file isn't text or is too large to show.")).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialog).getByText('logo.png')) })
    expect(await within(dialog).findByText("New file. It isn't text or is too large to show.")).toBeTruthy()
  })
})

describe('computerPathTail', () => {
  it('keeps a short path whole', () => {
    expect(computerPathTail('/Users/me/Projects/site')).toBe('/Users/me/Projects/site')
  })

  it('cuts the start of a long path at a separator', () => {
    const long = '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Work/Clients/Acme/Projects/site'
    const tail = computerPathTail(long, 40)
    expect(tail.startsWith('…/')).toBe(true)
    expect(tail.endsWith('/Acme/Projects/site')).toBe(true)
    expect(tail.length).toBeLessThanOrEqual(40)
  })

  it('uses backslashes for Windows paths', () => {
    expect(computerPathTail('C:\\Users\\Ada\\Documents\\Very\\Deep\\Folder\\Structure\\site', 24)).toBe('…\\Folder\\Structure\\site')
  })
})

