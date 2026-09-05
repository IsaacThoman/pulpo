// @vitest-environment jsdom
import { useSettings } from '@/stores/settings'
import { useComposerSyncPreference } from '@/stores/composer-sync-preference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerSync } from '@pulpo/client-core'
import { emptyComposerState, type ComposerAck, type ComposerSnapshot } from '@pulpo/contracts'
vi.mock('@/lib/animation-speed', () => ({ DEFAULT_ANIMATION_SPEED: 1, normalizeAnimationSpeed: () => 1, startAnimationSpeedController: () => {}, applyAnimationSpeed: () => {} }))
vi.hoisted(() => { window.matchMedia = (() => ({ matches: false, addEventListener: () => {} })) as unknown as typeof window.matchMedia })
const registry = vi.hoisted(() => ({ sync: null as ComposerSync | null }))
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => registry.sync }))
import { useComposerSync } from './use-composer-sync'

let snapshot: ComposerSnapshot
let writes: number
beforeEach(() => {
  useSettings.setState({ composerSyncEnabled: true })
  useComposerSyncPreference.setState({ enabled: true, generation: '' })
  registry.sync?.dispose()
  writes = 0
  snapshot = { draftId: 'new', state: emptyComposerState(), revision: 0, clearedRevision: 0, mutationId: null }
  registry.sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'test')
  registry.sync.connect({
    read: async (draftId) => ({ ok: true, snapshot: { ...snapshot, draftId } }),
    write: async (input): Promise<ComposerAck> => {
      writes++
      snapshot = { ...snapshot, draftId: input.draftId, state: input.clear ? emptyComposerState() : { ...snapshot.state, ...input.patch }, revision: snapshot.revision + 1 }
      return { ok: true, snapshot }
    },
  })
})
function useDraft() {
  const [state, setState] = useState(emptyComposerState)
  const sync = useComposerSync('account', 'new', state, true, false, setState)
  return { state, setState, ...sync }
}
describe('composer view binding', () => {
  it('does not replay submitted text when controls change before queue acceptance', async () => {
    const view = renderHook(useDraft)
    await act(async () => { view.result.current.setState((state) => ({ ...state, content: 'queued' })) })
    const submitted = view.result.current.state
    await act(async () => { await registry.sync!.prepareSubmission('new', submitted) })
    await act(async () => {
      view.result.current.skipNextEdit()
      view.result.current.setState((state) => ({ ...state, content: '' }))
    })
    await act(async () => { view.result.current.setState((state) => ({ ...state, agentMode: false })) })
    expect(view.result.current.state.content).toBe('')
    await act(async () => { await registry.sync!.completeSubmission('new', submitted) })
    expect(view.result.current.state.content).toBe('')
    view.unmount()
  })
  it('keeps local editing functional while sync is disabled', async () => {
    useSettings.getState().set('composerSyncEnabled', false)
    const view = renderHook(useDraft)
    await act(async () => { view.result.current.setState((state) => ({ ...state, content: 'local draft' })) })
    expect(view.result.current.sync).toBeNull()
    expect(view.result.current.state.content).toBe('local draft')
    expect(writes).toBe(0)
    view.unmount()
  })
  it('updates two mounted clients without echoes', async () => {
    const a = renderHook(useDraft), b = renderHook(useDraft)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await act(async () => { a.result.current.setState((state) => ({ ...state, content: 'hello' })) })
    await act(async () => { await registry.sync!.flush('new') })
    await waitFor(() => expect(b.result.current.state.content).toBe('hello'))
    expect(writes).toBe(1)
    a.unmount(); b.unmount()
  })
  it('does not publish outgoing UI state into a newly selected unhydrated chat', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    await registry.sync!.open(other, emptyComposerState(), () => {})
    const view = renderHook(({ draftId, hydrated }) => {
      const [state, setState] = useState(emptyComposerState)
      useComposerSync('account', draftId, state, hydrated, false, setState)
      return { state, setState }
    }, { initialProps: { draftId: 'new', hydrated: true } })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const before = writes
    await act(async () => {
      view.rerender({ draftId: other, hydrated: false })
      view.result.current.setState((state) => ({ ...state, content: 'outgoing UI' }))
    })
    await act(async () => { await registry.sync!.flush(other) })
    expect(writes).toBe(before)
    view.unmount()
  })
  it('applies remote controls and keeps optimistic local clear from publishing', async () => {
    const a = renderHook(useDraft)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await act(async () => registry.sync!.receive({ ...snapshot, revision: 1, state: { ...emptyComposerState(), content: 'sent', model: { id: 'remote', presets: {} } } }))
    expect(a.result.current.state.model?.id).toBe('remote')
    await act(async () => {
      a.result.current.skipNextEdit()
      a.result.current.setState((state) => ({ ...state, content: '' }))
    })
    await act(async () => { await registry.sync!.flush('new') })
    expect(writes).toBe(0)
    a.unmount()
  })
})
