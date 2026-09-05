// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSync } from '@pulpo/client-core'
import { emptyComposerState, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'

const coordinator = vi.hoisted(() => ({ current: null as ComposerSync | null }))
vi.mock('./composerSync', () => ({ mobileComposerSync: () => coordinator.current }))
vi.mock('../../store/preferences', () => ({
  usePreferencesStore: Object.assign(() => true, { getState: () => ({ composerSyncEnabled: true }) }),
}))
import { useComposerSync } from './useComposerSync'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  coordinator.current?.dispose()
})

async function fixture(remoteModel: ComposerState['model']) {
  const localModel = { id: 'model', presets: { effort: 'medium' } }
  const initial: ComposerSnapshot = {
    draftId: 'new', revision: 1, clearedRevision: 0, mutationId: null,
    state: { ...emptyComposerState(), content: 'shared draft', model: remoteModel },
  }
  const snapshots = new Map<string, ComposerSnapshot>([['new', initial]])
  const snapshotFor = (draftId: string): ComposerSnapshot => snapshots.get(draftId) ?? {
    draftId, revision: 0, clearedRevision: 0, mutationId: null, state: emptyComposerState(),
  }
  const writes: ComposerWrite[] = []
  const sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'test')
  coordinator.current = sync
  sync.connect({
    read: async (draftId) => ({ ok: true, snapshot: snapshotFor(draftId) }),
    write: async (input) => {
      writes.push(input)
      let snapshot = snapshotFor(input.draftId)
      if (input.baseRevision !== snapshot.revision) return { ok: true, snapshot, conflict: true }
      const revision = snapshot.revision + 1
      snapshot = { ...snapshot, revision, mutationId: input.mutationId,
        clearedRevision: input.clear ? revision : snapshot.clearedRevision,
        state: input.clear ? { ...snapshot.state, content: '', attachments: [] } : { ...snapshot.state, ...input.patch },
      }
      snapshots.set(input.draftId, snapshot)
      return { ok: true, snapshot }
    },
  })
  let state!: ComposerState
  let setState!: (state: ComposerState) => void
  let controls!: ReturnType<typeof useComposerSync>
  function Composer({ draftId }: { draftId: string }) {
    const [value, update] = useState<ComposerState>({ ...emptyComposerState(), model: localModel })
    state = value
    setState = update
    controls = useComposerSync('user', draftId, value, true, false, (remote) => {
      // Mobile resolves missing/stale preset choices against the model catalog.
      update({ ...remote, model: localModel })
    })
    return null
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async (draftId: string) => {
    await act(async () => root!.render(createElement(Composer, { draftId })))
  }
  await render('new')
  return { sync, writes, render, state: () => state, controls: () => controls, snapshot: () => snapshotFor('new'),
    type: async (content: string) => { await act(async () => setState({ ...state, content })) },
    change: async (patch: Partial<ComposerState>) => { await act(async () => setState({ ...state, ...patch })) },
    echo: async (patch: Partial<ComposerState> = {}) => {
      const previous = snapshotFor('new')
      const snapshot = { ...previous, revision: previous.revision + 1, state: { ...previous.state, ...patch } }
      snapshots.set('new', snapshot)
      await act(async () => sync.receive(snapshot))
    },
  }
}

describe('mobile composer submission', () => {
  it('keeps attachment-only submissions hidden until acceptance', async () => {
    const f = await fixture({ id: 'model', presets: { effort: 'medium' } })
    await f.change({ content: '', attachments: [{ id: 'image', name: 'photo.png', mimeType: 'image/png', size: 123 }] })
    const submitted = f.state()
    const revision = await f.sync.prepareSubmission('new', submitted)
    f.controls().skipNextEdit()
    await f.change({ attachments: [] })
    await f.echo()
    expect(f.state().attachments).toEqual([])
    await act(async () => { await f.sync.completeSubmission('new', submitted, revision!) })
    expect(f.state().attachments).toEqual([])
  })
  it('applies a different remote draft while a queued send is pending', async () => {
    const f = await fixture({ id: 'model', presets: { effort: 'medium' } })
    const submitted = f.state()
    const revision = await f.sync.prepareSubmission('new', submitted)
    f.controls().skipNextEdit()
    await f.type('')
    await f.echo({ content: 'new remote draft' })
    expect(f.state().content).toBe('new remote draft')
    await act(async () => { await f.sync.completeSubmission('new', submitted, revision!) })
    expect(f.state().content).toBe('new remote draft')
  })
  it('keeps a queued draft hidden through a delayed sync notification on the same client', async () => {
    const f = await fixture({ id: 'model', presets: { effort: 'medium' } })
    const submitted = f.state()
    const revision = await f.sync.prepareSubmission('new', submitted)
    f.controls().skipNextEdit()
    await f.type('')
    await f.echo()
    expect(f.state().content).toBe('')
    await act(async () => { await f.sync.completeSubmission('new', submitted, revision!) })
    expect(f.state().content).toBe('')
  })
  it('does not resurrect a queued draft when local controls change before acceptance', async () => {
    const f = await fixture({ id: 'model', presets: { effort: 'medium' } })
    const submitted = f.state()
    const revision = await f.sync.prepareSubmission('new', submitted)
    f.controls().skipNextEdit()
    await f.type('')
    await f.change({ agentMode: false })
    expect(f.state().content).toBe('')
    await act(async () => { await f.sync.completeSubmission('new', submitted, revision!) })
    expect(f.snapshot().state).toMatchObject({ content: '', agentMode: false })
    expect(f.state()).toMatchObject({ content: '', agentMode: false })
  })
  it('does not echo an already resolved remote draft', async () => {
    const f = await fixture({ id: 'model', presets: { effort: 'medium' } })
    expect(f.state().content).toBe('shared draft')
    expect(f.writes).toEqual([])
  })
  it('preserves a newer draft typed while a send is pending', async () => {
    const f = await fixture({ id: 'model', presets: {} })
    await f.type('send this')
    const submitted = f.state()
    let revision: number | null = null
    await act(async () => { revision = await f.sync.prepareSubmission('new', submitted) })
    f.controls().skipNextEdit()
    await f.type('')
    await f.type('next message')
    await act(async () => { await f.sync.completeSubmission('new', submitted, revision!) })
    expect(f.snapshot().state.content).toBe('next message')
    expect(f.writes.some((write) => write.clear)).toBe(false)
  })
  it.each<ComposerState['model']>([null, { id: 'model', presets: {} }, { id: 'model', presets: { effort: 'medium' } }])('clears a sent new-chat draft with resolved model defaults (%j)', async (model) => {
    const f = await fixture(model)
    await f.type('send this')
    const submitted = f.state()
    let revision: number | null = null
    await act(async () => { revision = await f.sync.prepareSubmission('new', submitted) })
    expect(revision).not.toBeNull()
    f.controls().skipNextEdit()
    await f.type('')
    await f.render('created-chat')
    await act(async () => { await f.sync.completeSubmission('new', submitted, revision!) })
    expect(f.snapshot().state.content).toBe('')
    expect(f.writes.some((write) => write.draftId === 'new' && write.clear)).toBe(true)
    await f.render('new')
    expect(f.state().content).toBe('')
  })
})
