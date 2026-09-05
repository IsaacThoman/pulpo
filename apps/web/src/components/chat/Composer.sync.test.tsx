// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyComposerState, type ComposerSnapshot, type ComposerWrite } from '@pulpo/contracts'
import { ComposerSync } from '@pulpo/client-core'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
const fixture = vi.hoisted(() => ({ sync: null as ComposerSync | null, rows: new Map<string, unknown>() }))
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => fixture.sync, clearWebComposerSync() {} }))
vi.mock('@/lib/local-first/database', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, localAccountKey: (id: string) => id, localDb: {
    drafts: {
      where: () => ({ equals: ([userId, chatId]: string[]) => ({
        first: async () => fixture.rows.get(`${userId}:${chatId}`),
        delete: async () => { fixture.rows.delete(`${userId}:${chatId}`) },
      }) }),
      put: async (row: { userId: string; chatId: string }) => { fixture.rows.set(`${row.userId}:${row.chatId}`, row) },
    },
  } }
})
const { Composer } = await import('./Composer')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft, saveComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { useComposerSyncPreference } = await import('@/stores/composer-sync-preference')

beforeEach(() => {
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
  useSettings.setState({ agentModes: { model: false } })
  useComposerSyncPreference.setState({ enabled: true, generation: '' })
  fixture.rows.clear()
  clearRuntimeComposerDrafts('account')
})
afterEach(() => { cleanup(); fixture.sync?.dispose(); vi.useRealTimers() })

it.each([false, true])('does not reload a persisted sent draft after a remote clear (runtime cache: %s)', async (runtimeCached) => {
  const draftId = '11111111-1111-4111-8111-111111111111'
  const state = { ...emptyComposerState(), content: 'sent from mobile', model: { id: 'model', presets: {} } }
  let snapshot: ComposerSnapshot = { draftId, state, revision: 1, clearedRevision: 0, mutationId: null }
  const write = vi.fn(async (input: ComposerWrite) => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, mutationId: input.mutationId,
      state: { ...snapshot.state, ...input.patch } }
    return { ok: true as const, snapshot }
  })
  fixture.sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'web')
  fixture.sync.connect({ read: async () => ({ ok: true, snapshot }), write })
  await saveComposerDraft('account', draftId, { content: state.content, attachments: [] })
  if (runtimeCached) rememberRuntimeComposerDraft('account', draftId, { content: state.content, attachments: [], attachmentIds: [] })
  const composer = (centered = false) => <MemoryRouter><TooltipProvider><Composer chatId={draftId} modelId="model" centered={centered} /></TooltipProvider></MemoryRouter>
  const view = render(composer())
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(input.value).toBe(state.content))
  await act(async () => { await fixture.sync!.flush(draftId) })
  write.mockClear()
  vi.useFakeTimers()
  snapshot = { ...snapshot, revision: 2, clearedRevision: 2, state: { ...state, content: '' } }
  await act(async () => fixture.sync!.receive(snapshot))
  expect(input.value).toBe('')
  // Queue/transcript/store updates can render again before the 150ms disk save.
  await act(async () => view.rerender(composer(true)))
  await act(async () => { await vi.advanceTimersByTimeAsync(150) })
  expect(input.value).toBe('')
  expect(write).not.toHaveBeenCalled()
})
