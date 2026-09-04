import { describe, expect, it, vi } from 'vitest'
import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'
import { ComposerSync, composerPatch, type ComposerCheckpoint } from './composer-sync.js'

const state = (content = ''): ComposerState => ({ ...emptyComposerState(), content })
function fixture() {
  let snapshot: ComposerSnapshot = { draftId: 'new', revision: 0, clearedRevision: 0, state: state(), mutationId: null }
  const writes: ComposerWrite[] = []
  const transport = {
    read: async (): Promise<ComposerAck> => ({ ok: true, snapshot }),
    write: async (input: ComposerWrite): Promise<ComposerAck> => {
      writes.push(input)
      if (snapshot.mutationId === input.mutationId) return { ok: true, snapshot }
      if (input.baseRevision !== snapshot.revision) return { ok: true, snapshot, conflict: true }
      const revision = snapshot.revision + 1
      snapshot = { ...snapshot, revision, mutationId: input.mutationId, clearedRevision: input.clear ? revision : snapshot.clearedRevision,
        state: input.clear ? { ...snapshot.state, content: '', attachments: [] } : { ...snapshot.state, ...input.patch } }
      return { ok: true, snapshot }
    },
  }
  function client(id: string, saved: ComposerCheckpoint | null = null) {
    const save = vi.fn(async (key: string, value: ComposerCheckpoint) => { saved = structuredClone(value) })
    const sync = new ComposerSync({ load: async () => saved, save }, id)
    const listener = vi.fn()
    return { sync, save, listener, saved: () => saved, open: async (initial = state()) => { sync.connect(transport); await sync.open('new', initial, listener) } }
  }
  return { transport, client, writes, snapshot: () => snapshot }
}

describe('composer realtime synchronization', () => {
  it('imports once and applies remote revisions without echo writes', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(state('hello'))
    await b.open()
    expect(f.snapshot().state.content).toBe('hello')
    expect(f.writes).toHaveLength(1)
    b.sync.receive(f.snapshot()); b.sync.receive({ ...f.snapshot(), revision: 0 })
    expect(f.writes).toHaveLength(1)
    a.sync.dispose(); b.sync.dispose()
  })
  it('rebases concurrent online patches without overwriting unrelated fields', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(); await b.open()
    a.sync.edit('new', { content: 'typing' }); await a.sync.flush('new')
    b.sync.edit('new', { model: { id: 'other', presets: { effort: 'high' } } }); await b.sync.flush('new')
    expect(f.snapshot().state).toMatchObject({ content: 'typing', model: { id: 'other' } })
    b.sync.edit('new', { content: 'last edit' }); await b.sync.flush('new')
    expect(f.snapshot().state.content).toBe('last edit')
    a.sync.dispose(); b.sync.dispose()
  })
  it('keeps the server version and a recoverable local copy after offline conflict', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(); await b.open()
    a.sync.disconnect(); a.sync.edit('new', { content: 'offline text' })
    b.sync.edit('new', { content: 'online text' }); await b.sync.flush('new')
    a.sync.connect(f.transport)
    await vi.waitFor(() => expect(a.listener.mock.lastCall?.[0].recovery?.content).toBe('offline text'))
    expect(f.snapshot().state.content).toBe('online text')
    a.sync.recover('new'); await a.sync.flush('new')
    expect(f.snapshot().state.content).toBe('offline text')
    a.sync.dispose(); b.sync.dispose()
  })
  it('preserves newer edits on conditional send clear', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(state('submitted')); await b.open()
    const revision = await a.sync.flush('new')
    b.sync.edit('new', { content: 'next draft' }); await b.sync.flush('new')
    await a.sync.clear('new', revision!)
    expect(f.snapshot().state.content).toBe('next draft')
    a.sync.dispose(); b.sync.dispose()
  })
  it('does not resurrect a sent draft with delayed writes or old local storage', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(state('submitted')); await b.open()
    const saved = b.saved()
    await a.sync.clear('new', (await a.sync.flush('new'))!)
    b.sync.edit('new', { content: 'stale delayed typing' }); await b.sync.flush('new')
    expect(f.snapshot().state.content).toBe('')
    expect(b.listener.mock.lastCall?.[0].recovery?.content).toBe('stale delayed typing')
    const c = f.client('c', saved); await c.open(state('submitted'))
    expect(f.snapshot().state.content).toBe('')
    a.sync.dispose(); b.sync.dispose(); c.sync.dispose()
  })
  it('persists pending edits while offline and replays when the base still matches', async () => {
    const f = fixture(), a = f.client('a')
    await a.open()
    a.sync.disconnect(); a.sync.edit('new', { content: 'offline' })
    await vi.waitFor(() => expect(a.saved()?.pending.content).toBe('offline'))
    const b = f.client('b', a.saved()); await b.open()
    expect(f.snapshot().state.content).toBe('offline')
    a.sync.dispose(); b.sync.dispose()
  })
  it('coalesces typing with a trailing flush during continuous input', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(), a = f.client('a'); await a.open()
      a.sync.edit('new', { content: 'a' }); await vi.advanceTimersByTimeAsync(100)
      a.sync.edit('new', { content: 'ab' }); await vi.advanceTimersByTimeAsync(50)
      expect(f.snapshot().state.content).toBe('ab')
      a.sync.edit('new', { content: 'abc' }); await vi.advanceTimersByTimeAsync(150)
      expect(f.writes).toHaveLength(2)
      a.sync.dispose()
    } finally { vi.useRealTimers() }
  })
  it('compares jsonb objects independently of key order', () => {
    const a = { ...state('same'), model: { id: 'm', presets: { a: '1', b: '2' } } }
    const b = { ...state('same'), model: { presets: { b: '2', a: '1' }, id: 'm' } }
    expect(composerPatch(a, b)).toEqual({})
  })
  it('groups model and presets while keeping content patches independent', () => {
    expect(composerPatch(state('a'), state('b'))).toEqual({ content: 'b' })
    expect(composerPatch(state(), { ...state(), model: { id: 'm', presets: { effort: 'high' } } })).toEqual({ model: { id: 'm', presets: { effort: 'high' } } })
  })
})

describe('submission acknowledgments', () => {
  it('clears the matching accepted draft after reconnect', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('submitted'))
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    a.sync.disconnect()
    await a.sync.completeSubmission('new', state('submitted'), revision!)
    const b = f.client('restarted', a.saved()); await b.open()
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    a.sync.dispose(); b.sync.dispose()
  })
  it('does not clear edits made while awaiting submission acknowledgment', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('submitted'))
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    a.sync.edit('new', { content: 'next message' })
    await a.sync.completeSubmission('new', state('submitted'), revision!)
    expect(f.snapshot().state.content).toBe('next message')
    a.sync.dispose()
  })
  it('does not claim a remotely replaced draft as the submitted version', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(state('submitted')); await b.open()
    b.sync.edit('new', { content: 'remote replacement' }); await b.sync.flush('new')
    a.sync.receive(f.snapshot())
    expect(await a.sync.prepareSubmission('new', state('submitted'))).toBeNull()
    await a.sync.completeSubmission('new', state('submitted'))
    expect(f.snapshot().state.content).toBe('remote replacement')
    a.sync.dispose(); b.sync.dispose()
  })
})
