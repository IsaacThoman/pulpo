import { describe, expect, it, vi } from 'vitest'
import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'
import { ComposerSync, composerPatch, localComposerDraftId, type ComposerCheckpoint } from './composer-sync.js'

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
  function client(id: string, saved: ComposerCheckpoint | null = null, recoverShelfContent?: (state: ComposerState) => Promise<void>) {
    const save = vi.fn(async (key: string, value: ComposerCheckpoint) => { saved = structuredClone(value) })
    const sync = new ComposerSync({ load: async () => saved, save, recoverShelfContent }, id)
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
  it.each([false, true])('recovers a lost acknowledgement without overwriting another writer (remote edit: %s)', async (remoteEdit) => {
    const f = fixture(), a = f.client('a')
    await a.open()
    a.sync.connect({ ...f.transport, write: async (input) => {
      await f.transport.write(input)
      throw new Error('connection lost after commit')
    } })
    await a.sync.open('new', state(), a.listener)
    a.sync.edit('new', { content: 'Offline reta' })
    await a.sync.flush('new')
    a.sync.disconnect()
    a.sync.edit('new', { content: 'Offline retained draft' })
    await vi.waitFor(() => expect(a.saved()?.pending.content).toBe('Offline retained draft'))
    const checkpoint = a.saved()
    if (remoteEdit) {
      const other = f.client('other')
      await other.open()
      other.sync.edit('new', { content: 'New draft from another device' })
      await other.sync.flush('new')
      other.sync.dispose()
    }
    a.sync.dispose()
    const restarted = f.client('restarted', checkpoint)
    await restarted.open()
    expect(f.snapshot().state.content).toBe(remoteEdit ? 'New draft from another device' : 'Offline retained draft')
    restarted.sync.dispose()
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

describe('explicit shelf restore recovery', () => {
  it('saves a divergent offline restore before adopting another device’s composer', async () => {
    const f = fixture(), recover = vi.fn(async () => {}), a = f.client('a', null, recover), b = f.client('b')
    await a.open(); await b.open()
    a.sync.disconnect()
    a.sync.replaceShelfContent('new', state('restored offline'))
    b.sync.edit('new', { content: 'newer device draft' }); await b.sync.flush('new')
    a.sync.connect(f.transport)
    await vi.waitFor(() => expect(recover).toHaveBeenCalledWith(state('restored offline')))
    await vi.waitFor(() => expect(a.listener.mock.lastCall?.[0].snapshot.state.content).toBe('newer device draft'))
    expect(a.listener.mock.lastCall?.[0].pending).toEqual({})
    expect(recover).toHaveBeenCalledTimes(1)
    a.sync.dispose(); b.sync.dispose()
  })
  it('retains the protected restore when saving its recovery copy fails', async () => {
    const f = fixture(), recover = vi.fn(async () => { throw new Error('disk full') }), a = f.client('a', null, recover), b = f.client('b')
    await a.open(); await b.open(); a.sync.disconnect()
    a.sync.replaceShelfContent('new', state('protected'))
    b.sync.edit('new', { content: 'remote' }); await b.sync.flush('new')
    a.sync.connect(f.transport)
    await vi.waitFor(() => expect(recover).toHaveBeenCalled())
    expect(a.saved()?.shelfContent?.content).toBe('protected')
    expect(a.saved()?.pending.content).toBe('protected')
    a.sync.dispose(); b.sync.dispose()
  })
  it('restores only content and attachments, preserving the active controls', async () => {
    const f = fixture(), a = f.client('a')
    const initial = { ...state('before'), model: { id: 'chosen', presets: { effort: 'high' } }, agentMode: false, autoExpire: true }
    await a.open(initial)
    a.sync.replaceShelfContent('new', { ...state('after'), model: { id: 'ignored', presets: {} } })
    await a.sync.flush('new')
    expect(f.snapshot().state).toEqual({ ...initial, content: 'after' })
    a.sync.dispose()
  })
})


describe('temporary draft protocol isolation', () => {
  it('uses separate local draft slots without sharing the mode bit', () => {
    expect(localComposerDraftId(null, false)).toBe('new')
    expect(localComposerDraftId(null, true)).toBe('temporary:new')
    expect(localComposerDraftId('chat', true)).toBe('temporary:chat')
    expect(composerPatch(state(), { ...state(), temporary: true })).toEqual({})
  })

  it('never loads or publishes temporary initial drafts', async () => {
    const f = fixture(), a = f.client('a')
    await a.open({ ...state('private initial'), temporary: true })
    expect(a.listener).not.toHaveBeenCalled()
    expect(a.save).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
    a.sync.dispose()
  })

  it('rejects whole temporary edits and excludes the mode field from normal writes', async () => {
    const f = fixture(), a = f.client('a')
    await a.open(state('normal'))
    a.sync.edit('new', { temporary: true, content: 'secret' })
    await a.sync.flush('new')
    expect(f.snapshot().state.content).toBe('normal')
    a.sync.edit('new', { temporary: false, content: 'normal edit' })
    await a.sync.flush('new')
    expect(f.writes.every((write) => !Object.hasOwn(write.patch, 'temporary'))).toBe(true)
    a.sync.dispose()
  })

  it.each(['snapshot', 'pending'] as const)('retires legacy temporary %s checkpoints without replaying their content', async (field) => {
    const f = fixture()
    const saved: ComposerCheckpoint = {
      snapshot: { ...f.snapshot(), state: { ...state('private snapshot'), temporary: field === 'snapshot' } },
      pending: { content: 'private pending', temporary: field === 'pending' },
      submissions: [{ state: { ...state('private receipt'), temporary: true } }],
      shelfContent: state('private shelf recovery'),
    }
    const recover = vi.fn()
    const a = f.client('a', saved, recover)
    await a.open(state('private local draft'))
    expect(f.writes).toEqual([])
    expect(JSON.stringify(a.listener.mock.lastCall)).not.toContain('private')
    expect(recover).not.toHaveBeenCalled()
    a.sync.dispose()
  })

  it('ignores temporary snapshots from older servers and clients', async () => {
    const f = fixture(), a = f.client('a')
    await a.open()
    a.listener.mockClear()
    a.sync.receive({ ...f.snapshot(), revision: 100, state: { ...state('private remote'), temporary: true } })
    expect(a.listener).not.toHaveBeenCalled()
    a.sync.dispose()
  })
})


it('does not apply a temporary snapshot returned in a write acknowledgement', async () => {
  const f = fixture(), a = f.client('a')
  await a.open()
  const write = vi.fn(async (): Promise<ComposerAck> => ({ ok: true, conflict: true,
    snapshot: { ...f.snapshot(), revision: 99, state: { ...state('private conflict'), temporary: true } },
  }))
  a.sync.connect({ ...f.transport, write })
  await a.sync.open('new', state(), () => {})
  a.sync.edit('new', { content: 'normal edit' })
  await a.sync.flush('new')
  expect(write).toHaveBeenCalledOnce()
  expect(JSON.stringify(a.listener.mock.calls)).not.toContain('private conflict')
  a.sync.dispose()
})


it('does not share or clear a normal draft through temporary submission or shelf callbacks', async () => {
  const f = fixture(), a = f.client('a')
  await a.open(state('normal draft'))
  const before = f.writes.length
  const temporary = { ...state('private callback'), temporary: true }
  expect(await a.sync.prepareSubmission('new', temporary)).toBeNull()
  await a.sync.completeSubmission('new', temporary)
  a.sync.replaceShelfContent('new', temporary)
  await a.sync.flush('new')
  expect(f.writes).toHaveLength(before)
  expect(f.snapshot().state.content).toBe('normal draft')
  expect(JSON.stringify(a.saved())).not.toContain('private callback')
  a.sync.dispose()
})

describe('temporary composer handoffs', () => {
  it('takes content without publishing pending typing, retaining remote controls', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    const initial = { ...state('shared'), model: { id: 'model', presets: { effort: 'high' } }, autoExpire: true,
      attachments: [{ id: 'file', name: 'file', mimeType: 'text/plain', size: 1 }] }
    await a.open(initial); await b.open()
    a.sync.edit('new', { content: 'latest local keystrokes' })
    await a.sync.takeTemporary('new')
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    b.sync.receive(f.snapshot())
    expect(b.listener.mock.lastCall?.[0].snapshot.state).toEqual({ ...initial, content: '', attachments: [] })
    expect(f.writes.some((write) => write.patch.content === 'latest local keystrokes')).toBe(false)
    a.sync.edit('new', { content: 'private' })
    await a.sync.flush('new')
    expect(f.snapshot().state.content).toBe('')
    expect(JSON.stringify(a.saved())).not.toContain('shared')
    a.sync.dispose(); b.sync.dispose()
  })

  it.each([false, true])('retries a content-free offline take receipt without clearing newer work (%s)', async (newer) => {
    const f = fixture(), a = f.client('a'), b = f.client('b')
    await a.open(state('shared')); await b.open()
    a.sync.disconnect()
    a.sync.edit('new', { content: 'offline local' })
    await a.sync.takeTemporary('new')
    const checkpoint = a.saved()!
    expect(checkpoint.temporaryTake).toEqual({ revision: f.snapshot().revision, mutationId: undefined })
    expect(JSON.stringify(checkpoint)).not.toContain('shared')
    expect(JSON.stringify(checkpoint)).not.toContain('offline local')
    if (newer) { b.sync.edit('new', { content: 'newer draft' }); await b.sync.flush('new') }
    const resumed = f.client('resumed', checkpoint)
    await resumed.open()
    expect(f.snapshot().state.content).toBe(newer ? 'newer draft' : '')
    a.sync.dispose(); b.sync.dispose(); resumed.sync.dispose()
  })

  it.each([false, true])('retires an in-flight write even when its acknowledgement is lost (%s)', async (lostAck) => {
    const f = fixture(), a = f.client('a')
    await a.open(state('before'))
    let settle!: () => void
    const barrier = new Promise<void>((resolve) => { settle = resolve })
    a.sync.connect({ ...f.transport, write: async (input) => {
      const result = await f.transport.write(input)
      await barrier
      if (lostAck) throw new Error('lost acknowledgement')
      return result
    } })
    await a.sync.open('new', state(), a.listener)
    a.sync.edit('new', { content: 'in flight' })
    const flush = a.sync.flush('new')
    await a.sync.takeTemporary('new')
    expect(a.saved()?.temporaryTake?.mutationId).toBe(f.snapshot().mutationId)
    settle(); await flush
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    expect(a.saved()?.pending).toEqual({})
    a.sync.dispose()
  })

  it('returns all controls and preserves a divergent shared draft before publishing', async () => {
    const f = fixture(), recovered = vi.fn(async () => {}), a = f.client('a', null, recovered), b = f.client('b')
    await a.open(state('original')); await b.open()
    await a.sync.takeTemporary('new')
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe(''))
    b.sync.receive(f.snapshot())
    b.sync.edit('new', { content: 'other device' }); await b.sync.flush('new')
    const returning = { ...state('temporary edits'), temporary: true, model: { id: 'other-model', presets: { effort: 'low' } }, agentMode: false, autoExpire: true }
    await a.sync.returnFromTemporary('new', returning)
    await a.sync.open('new', state(), a.listener)
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe('temporary edits'))
    expect(f.snapshot().state).toEqual({ ...returning, temporary: false })
    expect(recovered).toHaveBeenCalledExactlyOnceWith(state('other device'), 'remote')
    b.sync.receive(f.snapshot())
    expect(b.listener.mock.lastCall?.[0].snapshot.state.content).toBe('temporary edits')
    a.sync.dispose(); b.sync.dispose()
  })

  it('retains an offline return through reload and preserves the shared draft on reconnect', async () => {
    const f = fixture(), a = f.client('a'), b = f.client('b'), recovered = vi.fn(async () => {})
    await a.open(state('original')); await b.open()
    a.sync.disconnect()
    await a.sync.takeTemporary('new')
    await a.sync.returnFromTemporary('new', state('returned offline'))
    b.sync.edit('new', { content: 'newer' }); await b.sync.flush('new')
    const resumed = f.client('resumed', a.saved(), recovered)
    await resumed.open()
    expect(f.snapshot().state.content).toBe('returned offline')
    expect(recovered).toHaveBeenCalledExactlyOnceWith(state('newer'), 'remote')
    a.sync.dispose(); b.sync.dispose(); resumed.sync.dispose()
  })

  it('does not overwrite shared content if saving its shelf copy fails', async () => {
    const f = fixture(), recovered = vi.fn(async (): Promise<void> => { throw new Error('disk full') }), a = f.client('a', null, recovered)
    await a.open(state('shared'))
    await a.sync.returnFromTemporary('new', state('returned'))
    await vi.waitFor(() => expect(recovered).toHaveBeenCalled())
    expect(f.snapshot().state.content).toBe('shared')
    expect(a.saved()?.pending.content).toBe('returned')
    recovered.mockImplementation(async () => {})
    a.sync.connect(f.transport)
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe('returned'))
    a.sync.dispose()
  })

  it('serializes a rapid return behind an already-sent clear', async () => {
    const f = fixture(), a = f.client('a', null, async () => {})
    await a.open(state('shared'))
    let settle!: () => void
    const barrier = new Promise<void>((resolve) => { settle = resolve })
    let clearing = false
    a.sync.connect({ ...f.transport, write: async (input) => {
      if (input.clear) { clearing = true; await barrier }
      return f.transport.write(input)
    } })
    await a.sync.open('new', state(), a.listener)
    await a.sync.takeTemporary('new')
    await vi.waitFor(() => expect(clearing).toBe(true))
    await a.sync.returnFromTemporary('new', state('returned'))
    settle()
    await vi.waitFor(() => expect(f.snapshot().state.content).toBe('returned'))
    expect(a.saved()?.temporaryReturn).toBeUndefined()
    a.sync.dispose()
  })
})

it('resumes ordinary new-chat edits after navigating away from temporary mode offline', async () => {
  const f = fixture(), a = f.client('a')
  await a.open(state('taken'))
  a.sync.disconnect()
  await a.sync.takeTemporary('new')
  await a.sync.open('new', state(), a.listener)
  a.sync.edit('new', { content: 'fresh normal draft' })
  a.sync.connect(f.transport)
  await vi.waitFor(() => expect(f.snapshot().state.content).toBe('fresh normal draft'))
  a.sync.dispose()
})

it('does not take a newer remote revision arriving while the local handoff is being staged', async () => {
  const f = fixture(), a = f.client('a'), b = f.client('b')
  await a.open(state('taken')); await b.open()
  b.sync.edit('new', { content: 'newer' }); await b.sync.flush('new')
  const take = a.sync.takeTemporary('new')
  a.sync.receive(f.snapshot())
  await take
  await a.sync.open('new', state(), a.listener)
  expect(f.snapshot().state.content).toBe('newer')
  a.sync.dispose(); b.sync.dispose()
})

it('surfaces failed handoff persistence without losing the normal pending draft', async () => {
  const f = fixture()
  let fail = false
  const sync = new ComposerSync({ load: async () => null, save: async () => { if (fail) throw new Error('disk full') } }, 'a')
  sync.connect(f.transport)
  const listener = vi.fn()
  await sync.open('new', state('shared'), listener)
  sync.edit('new', { content: 'latest local' })
  fail = true
  await expect(sync.takeTemporary('new')).rejects.toThrow('disk full')
  fail = false
  await sync.open('new', state(), listener)
  expect(listener.mock.lastCall?.[0].pending.content).toBe('latest local')
  await sync.flush('new')
  expect(f.snapshot().state.content).toBe('latest local')
  sync.dispose()
})

it('pauses writes during local storage transfer and rolls back if the local move fails', async () => {
  const f = fixture(), a = f.client('a')
  await a.open(state('shared'))
  a.sync.edit('new', { content: 'pending typing' })
  let fail!: (error: Error) => void
  const localSave = new Promise<void>((_, reject) => { fail = reject })
  const take = a.sync.takeTemporary('new', () => localSave)
  const rejected = expect(take).rejects.toThrow('local storage failed')
  await a.sync.flush('new')
  expect(f.snapshot().state.content).toBe('shared')
  fail(new Error('local storage failed'))
  await rejected
  await a.sync.flush('new')
  expect(f.snapshot().state.content).toBe('pending typing')
  a.sync.dispose()
})
