// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'
import { emptyComposerState, type ClientToServerEvents, type ServerToClientEvents, type ComposerAck, type ComposerSnapshot, type ComposerWrite } from '@pulpo/contracts'
const db = vi.hoisted(() => ({ rows: new Map<string, unknown>() }))
vi.mock('./database', () => ({
  localAccountKey: (userId: string) => `instance|${userId}`,
  localDb: { kv: {
    get: async (key: string) => db.rows.has(key) ? { value: db.rows.get(key) } : undefined,
    put: async ({ key, value }: { key: string; value: unknown }) => { db.rows.set(key, value) },
  } },
}))
import { useComposerSyncPreference } from '@/stores/composer-sync-preference'
import { bindWebComposerSocket, clearWebComposerSync, webComposerSync } from './composer-sync'

type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>
const cleanups: Array<() => void> = []
function socketFixture() {
  const listeners = new Map<string, Set<(value?: unknown) => void>>()
  const events: { name: string; input: unknown }[] = []
  let snapshot: ComposerSnapshot = { draftId: 'new', revision: 1, clearedRevision: 0, mutationId: null, state: { ...emptyComposerState(), content: 'shared draft' } }
  const socket = {
    connected: true, auth: {},
    on: (name: string, listener: (value?: unknown) => void) => { const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set) },
    off: (name: string, listener: (value?: unknown) => void) => listeners.get(name)?.delete(listener),
    emit: (name: string, input: unknown) => events.push({ name, input }),
    timeout: () => ({ emit: (name: string, input: ComposerWrite, ack: (error: null, result: ComposerAck) => void) => {
      events.push({ name, input })
      if (name === 'composer.write') snapshot = { ...snapshot, revision: snapshot.revision + 1, state: { ...snapshot.state, ...input.patch } }
      ack(null, { ok: true, snapshot })
    } }),
  }
  cleanups.push(bindWebComposerSocket('user', socket as unknown as PulpoSocket))
  return { socket, events, deliver: (name: string, value?: unknown) => listeners.get(name)?.forEach((listener) => listener(value)) }
}
beforeEach(() => {
  clearWebComposerSync()
  db.rows.clear()
  useComposerSyncPreference.setState({ enabled: true, generation: 0 })
})
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); clearWebComposerSync() })

describe('browser composer sync opt-out', () => {
  it('starts disabled without reading or writing drafts and informs the server', () => {
    useComposerSyncPreference.getState().setEnabled(false)
    const { events, socket } = socketFixture()
    expect(webComposerSync('user')).toBeNull()
    expect(socket.auth).toMatchObject({ composerSyncEnabled: false })
    expect(events).toEqual([{ name: 'composer.configure', input: { enabled: false } }])
  })
  it('cancels pending typing, ignores incoming updates, and blocks stale send callbacks immediately', async () => {
    const f = socketFixture(), sync = webComposerSync('user')!, listener = vi.fn()
    await sync.open('new', emptyComposerState(), listener)
    sync.edit('new', { content: 'not uploaded' })
    useComposerSyncPreference.getState().setEnabled(false)
    const writesBefore = f.events.filter((event) => event.name === 'composer.write').length
    const notificationsBefore = listener.mock.calls.length
    f.deliver('composer.changed', { draftId: 'new', revision: 99, clearedRevision: 0, mutationId: null, state: { ...emptyComposerState(), content: 'remote' } })
    await sync.flush('new')
    await sync.completeSubmission('new', emptyComposerState(), 1)
    expect(f.events.filter((event) => event.name === 'composer.write')).toHaveLength(writesBefore)
    expect(listener).toHaveBeenCalledTimes(notificationsBefore)
    expect(webComposerSync('user')).toBeNull()
    expect(f.events.at(-1)).toEqual({ name: 'composer.configure', input: { enabled: false } })
  })
  it('resumes server state without replaying retired queued edits after re-enabling', async () => {
    const f = socketFixture(), original = webComposerSync('user')!
    await original.open('new', emptyComposerState(), () => {})
    original.edit('new', { content: 'old pending edit' })
    useComposerSyncPreference.getState().setEnabled(false)
    useComposerSyncPreference.getState().setEnabled(true)
    const resumed = webComposerSync('user')!, listener = vi.fn()
    expect(resumed).not.toBe(original)
    await resumed.open('new', { ...emptyComposerState(), content: 'local while disabled' }, listener)
    expect(listener.mock.lastCall?.[0].snapshot.state.content).toBe('shared draft')
    expect(listener.mock.lastCall?.[0].pending).toEqual({})
    expect(f.events.filter((event) => event.name === 'composer.write')).toHaveLength(0)
    resumed.edit('new', { content: 'new shared edit' })
    await resumed.flush('new')
    expect(f.events.filter((event) => event.name === 'composer.write')).toHaveLength(1)
  })
  it('persists the browser opt-out across reloads and applies changes from another tab', async () => {
    useComposerSyncPreference.getState().setEnabled(false)
    const saved = window.localStorage.getItem('pulpo-composer-sync-preference')!
    useComposerSyncPreference.setState({ enabled: true, generation: 0 })
    window.localStorage.setItem('pulpo-composer-sync-preference', saved)
    window.dispatchEvent(new StorageEvent('storage', { key: 'pulpo-composer-sync-preference', newValue: saved }))
    await vi.waitFor(() => expect(useComposerSyncPreference.getState().enabled).toBe(false))
    expect(useComposerSyncPreference.getState().generation).toBe(1)
  })
})
