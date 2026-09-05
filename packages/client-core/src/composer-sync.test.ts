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
  it('adopts the server version and discards pending edits after offline conflict', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(); await b.open()
    a.sync.disconnect(); a.sync.edit('new', { content: 'offline text' })
    b.sync.edit('new', { content: 'online text' }); await b.sync.flush('new')
    a.sync.connect(f.transport)
    await vi.waitFor(() => expect(a.listener.mock.lastCall?.[0].snapshot.state.content).toBe('online text'))
    expect(a.listener.mock.lastCall?.[0].pending).toEqual({})
    expect(f.snapshot().state.content).toBe('online text')
    await a.sync.flush('new')
    expect(f.snapshot().state.content).toBe('online text')
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
    expect(b.listener.mock.lastCall?.[0].pending).toEqual({})
    const c = f.client('c', saved); await c.open(state('submitted'))
    expect(f.snapshot().state.content).toBe('')
    a.sync.dispose(); b.sync.dispose(); c.sync.dispose()
  })
  it('drops retired recovery copies when loading and rewriting a checkpoint', async () => {
    const f = fixture()
    const legacy = { snapshot: f.snapshot(), pending: {}, recovery: state('old recovery') }
    const a = f.client('a', legacy)
    await a.open()
    await vi.waitFor(() => expect(a.saved()).not.toHaveProperty('recovery'))
    expect(a.listener.mock.lastCall?.[0]).not.toHaveProperty('recovery')
    expect(f.snapshot().state.content).toBe('')
    a.sync.dispose()
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
  it('restores failed sends only when the draft has not changed', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('submitted'))
    expect(a.sync.canRestoreSubmission('new', state('submitted'))).toBe(true)
    a.sync.edit('new', { content: 'new draft' })
    expect(a.sync.canRestoreSubmission('new', state('submitted'))).toBe(false)
    await a.sync.flush('new')
    expect(f.snapshot().state.content).toBe('new draft')
    a.sync.dispose()
  })
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
  it('migrates a legacy single accepted-draft receipt', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('legacy accepted'))
    const saved: ComposerCheckpoint = { snapshot: f.snapshot(), pending: {}, submission: { state: state('legacy accepted'), revision: f.snapshot().revision } }
    a.sync.dispose()
    const b = f.client('upgraded', saved); await b.open()
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    expect(b.saved()).not.toHaveProperty('submission')
    b.sync.dispose()
  })
  it('clears an earlier accepted draft after multiple offline sends and relaunch', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('first accepted'))
    const revision = await a.sync.prepareSubmission('new', state('first accepted'))
    a.sync.disconnect()
    await a.sync.completeSubmission('new', state('first accepted'), revision!)
    await a.sync.completeSubmission('new', state('second accepted'))
    const b = f.client('restarted', a.saved()); await b.open()
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    a.sync.dispose(); b.sync.dispose()
  })
  it('preserves an unsubmitted remote draft after multiple offline sends', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('first accepted'))
    a.sync.disconnect()
    await a.sync.completeSubmission('new', state('first accepted'))
    await a.sync.completeSubmission('new', state('second accepted'))
    const remote = f.client('remote'); await remote.open()
    remote.sync.edit('new', { content: 'keep remote draft' }); await remote.sync.flush('new')
    const b = f.client('restarted', a.saved()); await b.open()
    expect(f.snapshot().state.content).toBe('keep remote draft')
    a.sync.dispose(); b.sync.dispose(); remote.sync.dispose()
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


describe('conditional submission clear races', () => {
  it('clears accepted content while preserving controls changed during submission', async () => {
    const f = fixture(), a = f.client('mobile')
    const submitted = state('queued before the first response token')
    await a.open(submitted)
    const revision = await a.sync.prepareSubmission('new', submitted)
    const controls = { model: { id: 'other', presets: { effort: 'high' } }, agentMode: false, autoExpire: true }
    a.sync.edit('new', controls)
    await a.sync.completeSubmission('new', submitted, revision!)
    expect(f.snapshot().state).toMatchObject({ content: '', ...controls })
    a.sync.dispose()
  })

  it('preserves a different attachment added to the same text during submission', async () => {
    const f = fixture(), a = f.client('mobile')
    const submitted = state('same caption')
    await a.open(submitted)
    const revision = await a.sync.prepareSubmission('new', submitted)
    const attachments = [{ id: 'image', name: 'photo.png', mimeType: 'image/png', size: 123 }]
    a.sync.edit('new', { attachments })
    await a.sync.completeSubmission('new', submitted, revision!)
    expect(f.snapshot().state).toMatchObject({ content: submitted.content, attachments })
    a.sync.dispose()
  })
  it('uses the current revision when an identical remote write advances the draft', async () => {
    const f = fixture(), a = f.client('mobile'), b = f.client('web')
    await a.open(state('submitted')); await b.open()
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    b.sync.edit('new', { content: 'submitted' }); await b.sync.flush('new')
    a.sync.receive(f.snapshot())
    await a.sync.completeSubmission('new', state('submitted'), revision!)
    expect(f.snapshot().state.content).toBe('')
    expect(f.writes.at(-1)).toMatchObject({ clear: true, baseRevision: revision! + 1 })
    a.sync.dispose(); b.sync.dispose()
  })

  it.each(['submitted', 'new remote draft'])('rechecks the state after a clear conflict (%s)', async (content) => {
    const f = fixture(), a = f.client('mobile'), b = f.client('web')
    await a.open(state('submitted')); await b.open()
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    const write = f.transport.write
    let raced = false
    f.transport.write = async (input) => {
      if (input.clear && !raced) {
        raced = true
        b.sync.edit('new', { content }); await b.sync.flush('new')
      }
      return write(input)
    }
    await a.sync.completeSubmission('new', state('submitted'), revision!)
    expect(f.snapshot().state.content).toBe(content === 'submitted' ? '' : content)
    expect(f.writes.filter((input) => input.clear)).toHaveLength(content === 'submitted' ? 2 : 1)
    a.sync.dispose(); b.sync.dispose()
  })

  it('keeps the receipt through a failed clear and restart with an advanced revision', async () => {
    const f = fixture(), a = f.client('mobile'), b = f.client('web')
    await a.open(state('submitted')); await b.open()
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    const write = f.transport.write
    f.transport.write = async (input) => input.clear ? { ok: false, error: 'temporarily_unavailable' } : write(input)
    await a.sync.completeSubmission('new', state('submitted'), revision!)
    await vi.waitFor(() => expect(a.saved()?.submissions).toHaveLength(1))
    b.sync.edit('new', { content: 'submitted' }); await b.sync.flush('new')
    f.transport.write = write
    const restarted = f.client('restarted', a.saved())
    a.sync.dispose()
    await restarted.open()
    expect(f.snapshot().state.content).toBe('')
    await vi.waitFor(() => expect(restarted.saved()?.submissions).toEqual([]))
    restarted.sync.dispose(); b.sync.dispose()
  })

  it('bounds repeated conflicts and retains the receipt for reconnect', async () => {
    const f = fixture(), a = f.client('mobile'), b = f.client('web')
    await a.open(state('submitted')); await b.open()
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    const write = f.transport.write
    f.transport.write = async (input) => {
      if (input.clear) { b.sync.edit('new', { content: 'submitted' }); await b.sync.flush('new') }
      return write(input)
    }
    await a.sync.completeSubmission('new', state('submitted'), revision!)
    expect(f.writes.filter((input) => input.clear)).toHaveLength(3)
    await vi.waitFor(() => expect(a.saved()?.submissions).toHaveLength(1))
    f.transport.write = write
    a.sync.disconnect(); a.sync.connect(f.transport)
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    a.sync.dispose(); b.sync.dispose()
  })
})


describe('submission clear lifecycle', () => {
  it('serializes simultaneous acceptance receipts for the same draft', async () => {
    const f = fixture(), a = f.client('mobile')
    await a.open(state('submitted'))
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    await Promise.all([
      a.sync.completeSubmission('new', state('submitted'), revision!),
      a.sync.completeSubmission('new', state('submitted'), revision!),
    ])
    expect(f.snapshot().state.content).toBe('')
    expect(f.writes.filter((input) => input.clear)).toHaveLength(1)
    await vi.waitFor(() => expect(a.saved()?.submissions).toEqual([]))
    a.sync.dispose()
  })

  it('does not retire receipts using a clear acknowledgment from an old connection', async () => {
    const f = fixture(), a = f.client('mobile'), b = f.client('web')
    await a.open(state('submitted')); await b.open()
    const revision = await a.sync.prepareSubmission('new', state('submitted'))
    const write = f.transport.write
    let acknowledge: (() => void) | undefined
    f.transport.write = async (input) => {
      const result = await write(input)
      if (input.clear) await new Promise<void>((resolve) => { acknowledge = resolve })
      return result
    }
    const completion = a.sync.completeSubmission('new', state('submitted'), revision!)
    await vi.waitFor(() => expect(acknowledge).toBeDefined())
    a.sync.disconnect()
    acknowledge!()
    await completion
    expect(a.saved()?.submissions).toHaveLength(1)
    expect(a.saved()?.clearRevision).toBe(revision)
    f.transport.write = write
    b.sync.receive(f.snapshot())
    b.sync.edit('new', { content: 'new remote draft' }); await b.sync.flush('new')
    a.sync.connect(f.transport)
    await vi.waitFor(() => expect(a.saved()?.submissions).toEqual([]))
    expect(f.snapshot().state.content).toBe('new remote draft')
    a.sync.dispose(); b.sync.dispose()
  })
})
