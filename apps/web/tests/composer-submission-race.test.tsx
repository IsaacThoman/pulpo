// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSync } from '@pulpo/client-core'
import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerState, type ComposerWrite } from '@pulpo/contracts'

const clients = vi.hoisted(() => ({ mobile: null as ComposerSync | null, web: null as ComposerSync | null }))
vi.mock('../../mobile/src/features/chat/composerSync', () => ({ mobileComposerSync: () => clients.mobile }))
vi.mock('../../mobile/src/store/preferences', () => ({ usePreferencesStore: Object.assign(() => true, { getState: () => ({ composerSyncEnabled: true }) }) }))
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => clients.web }))
vi.mock('@/stores/composer-sync-preference', () => ({ useComposerSyncPreference: Object.assign((select: (state: object) => unknown) => select({ enabled: true, generation: '' }), { getState: () => ({ enabled: true, generation: '' }) }) }))
import { useComposerSync as useMobileSync } from '../../mobile/src/features/chat/useComposerSync'
import { useComposerSync as useWebSync } from '../src/components/chat/use-composer-sync'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const draftId = '11111111-1111-4111-8111-111111111111'
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  clients.mobile?.dispose()
  clients.web?.dispose()
})

async function fixture() {
  const initial: ComposerState = { ...emptyComposerState(), content: 'message to queue', model: { id: 'model', presets: {} } }
  let snapshot: ComposerSnapshot = { draftId, revision: 1, clearedRevision: 0, mutationId: null, state: initial }
  const writes: Array<ComposerWrite & { conflict: boolean }> = []
  const transport = {
    read: async (): Promise<ComposerAck> => ({ ok: true, snapshot }),
    write: async (input: ComposerWrite): Promise<ComposerAck> => {
      const conflict = input.baseRevision !== snapshot.revision
      writes.push({ ...input, conflict })
      if (conflict) return { ok: true, snapshot, conflict }
      const revision = snapshot.revision + 1
      snapshot = { ...snapshot, revision, mutationId: input.mutationId,
        clearedRevision: input.clear ? revision : snapshot.clearedRevision,
        state: input.clear ? { ...snapshot.state, content: '', attachments: [] } : { ...snapshot.state, ...input.patch },
      }
      clients.mobile!.receive(snapshot)
      clients.web!.receive(snapshot)
      return { ok: true, snapshot }
    },
  }
  for (const name of ['mobile', 'web'] as const) {
    clients[name] = new ComposerSync({ load: async () => null, save: async () => {} }, name)
    clients[name]!.connect(transport)
  }
  let mobile!: { state: ComposerState; setState: (state: ComposerState) => void; skipNextEdit: () => void }
  let web!: ComposerState
  function Mobile() {
    const [state, setState] = useState(initial)
    const controls = useMobileSync('account', draftId, state, true, false, setState)
    mobile = { state, setState, skipNextEdit: controls.skipNextEdit }
    return null
  }
  function Web() {
    const [state, setState] = useState(initial)
    useWebSync('account', draftId, state, true, false, setState)
    web = state
    return null
  }
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root.render(createElement('div', null, createElement(Mobile), createElement(Web))))
  return { initial, writes, mobile: () => mobile, web: () => web, snapshot: () => snapshot,
    beginSend: async () => {
      let revision: number | null = null
      await act(async () => { revision = await clients.mobile!.prepareSubmission(draftId, mobile.state) })
      await act(async () => { mobile.skipNextEdit(); mobile.setState({ ...mobile.state, content: '', attachments: [] }) })
      expect(mobile.state.content).toBe('')
      return revision!
    },
  }
}

describe('queued submission with a second composer client regression', () => {
  it('keeps both composers empty when the web client only observes', async () => {
    const f = await fixture()
    const revision = await f.beginSend()
    await act(async () => { await clients.mobile!.completeSubmission(draftId, f.initial, revision) })
    expect(f.mobile().state.content).toBe('')
    expect(f.web().content).toBe('')
    expect(f.snapshot().state.content).toBe('')
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({ clear: true, conflict: false })
  })

  it('clears an accepted draft even after a same-state web write advances the revision', async () => {
    const f = await fixture()
    const revision = await f.beginSend()
    // A delayed/duplicate patch from the other client changes only the revision.
    await act(async () => {
      clients.web!.edit(draftId, { content: f.initial.content })
      await clients.web!.flush(draftId)
    })
    expect(f.mobile().state.content).toBe(f.initial.content)
    // The queue request has succeeded; mobile now records acceptance.
    await act(async () => { await clients.mobile!.completeSubmission(draftId, f.initial, revision) })
    expect(f.writes.at(-1)).toMatchObject({ clear: true, baseRevision: revision + 1, conflict: false })
    expect(f.mobile().state.content).toBe('')
    expect(f.web().content).toBe('')
    expect(f.snapshot().state.content).toBe('')
    // Reconnect keeps the successfully cleared draft empty.
    const transport = { read: async (): Promise<ComposerAck> => ({ ok: true, snapshot: f.snapshot() }), write: vi.fn() }
    clients.mobile!.disconnect()
    await act(async () => clients.mobile!.connect(transport))
    expect(transport.write).not.toHaveBeenCalled()
    expect(f.mobile().state.content).toBe('')
  })
})
