import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerWrite } from '@pulpo/contracts'
import type { PulpoSocket } from '../../providers/realtimeStore'
const rows = vi.hoisted(() => new Map<string, unknown>())
vi.mock('react-native', () => ({ Appearance: { setColorScheme: vi.fn() }, AppState: { addEventListener: () => ({ remove: () => {} }) } }))
vi.mock('../../data/database', () => ({
  getValue: async (namespace: string, key: string) => rows.get(`${namespace}:${key}`) ?? null,
  setValue: async (namespace: string, key: string, value: unknown) => { rows.set(`${namespace}:${key}`, value) },
}))
import { usePreferencesStore } from '../../store/preferences'
import { bindMobileComposerSocket, clearMobileComposerSync, mobileComposerSync } from './composerSync'

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
  cleanups.push(bindMobileComposerSocket('user', socket as unknown as PulpoSocket))
  return { socket, events, deliver: (name: string, value?: unknown) => listeners.get(name)?.forEach((listener) => listener(value)) }
}
beforeEach(() => {
  clearMobileComposerSync('user')
  rows.clear()
  usePreferencesStore.setState({ composerSyncEnabled: true, composerSyncGeneration: '' })
})
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); clearMobileComposerSync('user') })

describe('mobile account composer sync opt-out', () => {
  it('starts disabled without reading or writing drafts and informs the server', () => {
    usePreferencesStore.setState({ composerSyncEnabled: false })
    const { events, socket } = socketFixture()
    expect(mobileComposerSync('user')).toBeNull()
    expect(socket.auth).toMatchObject({ composerSyncEnabled: false })
    expect(events).toEqual([{ name: 'composer.configure', input: { enabled: false } }])
  })
  it('cancels pending typing, ignores incoming updates, and blocks stale send callbacks immediately', async () => {
    const f = socketFixture(), sync = mobileComposerSync('user')!, listener = vi.fn()
    await sync.open('new', emptyComposerState(), listener)
    sync.edit('new', { content: 'not uploaded' })
    usePreferencesStore.setState({ composerSyncEnabled: false })
    const writesBefore = f.events.filter((event) => event.name === 'composer.write').length
    const notificationsBefore = listener.mock.calls.length
    f.deliver('composer.changed', { draftId: 'new', revision: 99, clearedRevision: 0, mutationId: null, state: { ...emptyComposerState(), content: 'remote' } })
    await sync.flush('new')
    await sync.completeSubmission('new', emptyComposerState(), 1)
    expect(f.events.filter((event) => event.name === 'composer.write')).toHaveLength(writesBefore)
    expect(listener).toHaveBeenCalledTimes(notificationsBefore)
    expect(mobileComposerSync('user')).toBeNull()
    expect(f.events.at(-1)).toEqual({ name: 'composer.configure', input: { enabled: false } })
  })
  it('resumes server state without replaying retired queued edits after re-enabling', async () => {
    const f = socketFixture(), original = mobileComposerSync('user')!
    await original.open('new', emptyComposerState(), () => {})
    original.edit('new', { content: 'old pending edit' })
    usePreferencesStore.setState({ composerSyncEnabled: false })
    usePreferencesStore.setState({ composerSyncEnabled: true })
    const resumed = mobileComposerSync('user')!, listener = vi.fn()
    expect(resumed).not.toBe(original)
    await resumed.open('new', { ...emptyComposerState(), content: 'local while disabled' }, listener)
    expect(listener.mock.lastCall?.[0].snapshot.state.content).toBe('shared draft')
    expect(listener.mock.lastCall?.[0].pending).toEqual({})
    expect(f.events.filter((event) => event.name === 'composer.write')).toHaveLength(0)
    resumed.edit('new', { content: 'new shared edit' })
    await resumed.flush('new')
    expect(f.events.filter((event) => event.name === 'composer.write')).toHaveLength(1)
  })
})
